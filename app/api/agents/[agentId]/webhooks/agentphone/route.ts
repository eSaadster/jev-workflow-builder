import { after, NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  callConversationId,
  isAgentPhoneConfigured,
  payloadNumber,
  payloadString,
  verifyAgentPhoneSignature,
  WEBHOOK_SKEW_MS,
  type AgentPhoneWebhookPayload,
} from "../../../../../agent/server/agentphone";
import type { CallDirection, CallEvent } from "../../../../../agent/conversation";
import {
  getAgentPhoneConnection,
  getAgentRoomId,
} from "../../../../../agent/server/storage";
import {
  appendConversationEvent,
  endConversation,
  processTurn,
  startConversation,
  type TurnResult,
} from "../../../../../agent/server/turn-engine";

export const maxDuration = 120;

/**
 * AgentPhone per-agent webhook: the transport adapter between a live phone
 * call and the turn engine. This agentId is embedded in the registered URL, so
 * no callId → room lookup is needed — the conversation feed id is derived
 * deterministically (conv-call-<callId>).
 *
 *   POST /api/agents/<agentId>/webhooks/agentphone
 *
 * - `agent.message` (channel "voice"): the caller's speech transcript. Runs
 *   one processTurn and replies with the JSON AgentPhone speaks:
 *   `{ text, hangup?, action: "transfer"? }` — hangup maps to the engine
 *   ending the conversation (end_conversation tool / opt-out guardrail),
 *   transfer to the handoff tool.
 * - `agent.call_ended`: acked immediately; dispositions and end-of-call steps
 *   run after the response (the caller hung up, nobody is waiting on speech).
 *
 * Dev: without AGENTPHONE_API_KEY, connections are mocked and signature
 * verification is skipped, so deliveries can be replayed with curl:
 *
 *   curl -X POST localhost:3000/api/agents/<agentId>/webhooks/agentphone \
 *     -H 'Content-Type: application/json' \
 *     -d '{"event":"agent.message","channel":"voice","agentId":"agt-mock-x",
 *          "data":{"callId":"call_dev1","transcript":"hi, who is this?","from":"+15559876543"}}'
 */

// Best-effort dedupe of redeliveries (X-Webhook-ID). AgentPhone retries only
// on non-2xx, which this route avoids, so the in-memory window covers the
// realistic case; a serverless cold start can still double-process a retry.
const seenDeliveries = new Map<string, number>();
const SEEN_DELIVERIES_MAX = 500;

function isDuplicateDelivery(deliveryId: string): boolean {
  const now = Date.now();
  const last = seenDeliveries.get(deliveryId);

  if (last !== undefined) {
    return true;
  }

  seenDeliveries.set(deliveryId, now);

  if (seenDeliveries.size > SEEN_DELIVERIES_MAX) {
    const cutoff = now - WEBHOOK_SKEW_MS;

    for (const [id, at] of seenDeliveries) {
      if (at < cutoff) {
        seenDeliveries.delete(id);
      }
    }
  }

  return false;
}

function callEvent(args: {
  callId: string;
  direction: CallDirection;
  from: string;
  to: string;
  ended?: {
    status: "completed" | "failed";
    durationSeconds?: number;
    disconnectionReason?: string;
    summary?: string;
  };
}): CallEvent {
  return {
    id: `call-${nanoid(8)}`,
    at: Date.now(),
    kind: "call",
    callId: args.callId,
    direction: args.direction,
    status: args.ended?.status ?? "in-progress",
    from: args.from,
    to: args.to,
    ...(args.ended?.durationSeconds !== undefined
      ? { durationSeconds: args.ended.durationSeconds }
      : {}),
    ...(args.ended?.disconnectionReason
      ? { disconnectionReason: args.ended.disconnectionReason }
      : {}),
    ...(args.ended?.summary
      ? { summary: args.ended.summary }
      : {}),
  };
}

/** The JSON AgentPhone speaks; the transfer/hangup mapping of a TurnResult. */
function speechResponse(result: TurnResult): Record<string, unknown> {
  const fallback = result.ended
    ? "Thanks for the call — goodbye."
    : "Sorry, say that again?";

  const body: Record<string, unknown> = {
    text: result.reply.trim() !== "" ? result.reply : fallback,
  };

  if (result.handoff) {
    body.action = "transfer";
  } else if (result.ended) {
    body.hangup = true;
  }

  return body;
}

const APOLOGY_HANGUP = {
  text: "Sorry — I'm having a technical problem and need to end this call. Goodbye.",
  hangup: true,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const exampleId = request.nextUrl.searchParams.get("exampleId");
  const rawBody = await request.text();

  const connection = await getAgentPhoneConnection(agentId, exampleId);

  // An unconfigured agent still acks so AgentPhone stops retrying.
  if (!connection) {
    return NextResponse.json({ ignored: "agent not connected" });
  }

  const signature = request.headers.get("X-Webhook-Signature") ?? "";
  const timestamp = request.headers.get("X-Webhook-Timestamp") ?? "";
  const deliveryId = request.headers.get("X-Webhook-ID") ?? "";

  if (!connection.mock && isAgentPhoneConfigured()) {
    const age = Math.abs(Date.now() - Number(timestamp) * 1000);

    if (
      signature === "" ||
      timestamp === "" ||
      Number.isNaN(age) ||
      age > WEBHOOK_SKEW_MS ||
      !verifyAgentPhoneSignature({
        secret: connection.webhookSecret,
        timestamp,
        rawBody,
        signature,
      })
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  if (deliveryId !== "" && isDuplicateDelivery(deliveryId)) {
    return NextResponse.json({ ignored: "duplicate delivery" });
  }

  let payload: AgentPhoneWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as AgentPhoneWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Defense in depth: the number attached to this agent should be the one in
  // the delivery's agent id.
  if (
    payload.agentId !== undefined &&
    payload.agentId !== "" &&
    payload.agentId !== connection.agentId
  ) {
    return NextResponse.json({ ignored: "agent id mismatch" });
  }

  const roomId = getAgentRoomId(agentId, exampleId);

  /* ------------------------------ Voice turns ----------------------------- */

  if (payload.event === "agent.message" && payload.channel === "voice") {
    const callId = payloadString(payload, "callId") ?? "";
    const transcript = payloadString(payload, "transcript") ?? "";

    if (callId === "" || transcript.trim() === "") {
      return NextResponse.json({ ignored: "no callId or transcript" });
    }

    const conversationId = callConversationId(callId);

    let result = await processTurn({
      roomId,
      conversationId,
      text: transcript,
    });

    // First speech of an inbound call: the feed is created here, lazily, with
    // the caller's first utterance as the opening turn.
    if (result.error === "Conversation not found.") {
      const from = payloadString(payload, "from") ?? "(unknown)";
      const to = payloadString(payload, "to") ?? connection.number;
      const direction: CallDirection =
        payloadString(payload, "direction") === "outbound"
          ? "outbound"
          : "inbound";

      const started = await startConversation({
        roomId,
        conversationId,
        opening: transcript,
        trigger: "call",
        input: `Call from ${from}`,
        seedEvents: [
          callEvent({ callId, direction, from, to }),
        ],
      });

      result = { reply: started.reply, ended: false, handoff: false };
    }

    if (result.error) {
      console.error("Voice turn failed", result.error);
      return NextResponse.json(APOLOGY_HANGUP);
    }

    return NextResponse.json(speechResponse(result));
  }

  /* ------------------------------- Call ended ------------------------------ */

  if (payload.event === "agent.call_ended") {
    const callId = payloadString(payload, "callId") ?? "";

    if (callId === "") {
      return NextResponse.json({ ignored: "no callId" });
    }

    const conversationId = callConversationId(callId);
    const status =
      payloadString(payload, "status") === "failed" ? "failed" : "completed";
    const summary = payloadString(payload, "summary");
    const reason = payloadString(payload, "disconnectionReason");
    const durationSeconds = payloadNumber(payload, "durationSeconds");
    const from = payloadString(payload, "from") ?? "(unknown)";
    const to = payloadString(payload, "to") ?? connection.number;
    const direction: CallDirection =
      payloadString(payload, "direction") === "outbound"
        ? "outbound"
        : "inbound";

    // Fire-and-forget event: ack immediately, finish the conversation (caller
    // hung up) after the response so AgentPhone never waits on dispositions.
    after(async () => {
      const outcome = await endConversation({ roomId, conversationId });

      if (outcome.error === "Conversation not found.") {
        return;
      }

      // The feed may not exist when the call ended before any speech; only
      // record the wrap-up on conversations the engine actually ran.
      await appendConversationEvent({
        roomId,
        conversationId,
        event: callEvent({
          callId,
          direction,
          from,
          to,
          ended: {
            status,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            ...(reason ? { disconnectionReason: reason } : {}),
            ...(summary ? { summary } : {}),
          },
        }),
      });
    });

    return NextResponse.json({ acked: true });
  }

  // SMS and other channels could ride the same turn engine later; for now
  // they are acked and ignored.
  return NextResponse.json({ ignored: "unsupported event" });
}
