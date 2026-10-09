import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  callConversationId,
  placeOutboundCall,
} from "../../../../agent/server/agentphone";
import type { CallEvent } from "../../../../agent/conversation";
import {
  getAgent,
  getAgentPhoneConnection,
  getAgentRoomId,
} from "../../../../agent/server/storage";
import { generateGreeting, startConversation } from "../../../../agent/server/turn-engine";

// Greeting generation is one LLM call before dialing; the whole route stays
// under the platform limit like the other agent routes.
export const maxDuration = 120;

/**
 * Places an outbound phone call through AgentPhone and runs this agent's graph
 * on every turn of it.
 *
 *   POST /api/agents/<agentId>/calls
 *   { "toNumber": "+15559876543", "greeting": "Hi, this is Dana from…" }
 *
 * The greeting (or one generated from the agent's persona when omitted) is
 * spoken by AgentPhone when the call connects and seeds the conversation feed
 * as the agent's first line. Subsequent caller turns arrive via the webhook
 * route, one processTurn per speech transcript. The conversation feed id is
 * derived from the call id, so webhook deliveries map back deterministically.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return NextResponse.json(
      { error: "Missing LIVEBLOCKS_SECRET_KEY" },
      { status: 403 }
    );
  }

  const { agentId } = await params;
  const exampleId = request.nextUrl.searchParams.get("exampleId");

  let body: { toNumber?: unknown; greeting?: unknown } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Handled below: an empty body has no toNumber.
  }

  const toNumber =
    typeof body.toNumber === "string" ? body.toNumber.trim() : "";

  if (!/^\+[1-9]\d{7,14}$/.test(toNumber)) {
    return NextResponse.json(
      { error: "`toNumber` must be an E.164 phone number, e.g. +15559876543" },
      { status: 400 }
    );
  }

  const agent = await getAgent(agentId, exampleId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const connection = await getAgentPhoneConnection(agentId, exampleId);

  if (!connection) {
    return NextResponse.json(
      { error: "Connect a phone number first (POST /api/agents/<agentId>/phone)" },
      { status: 400 }
    );
  }

  const roomId = getAgentRoomId(agentId, exampleId);

  const providedGreeting =
    typeof body.greeting === "string" ? body.greeting.trim() : "";

  let greeting = providedGreeting;
  let greetingMock = false;

  if (greeting === "") {
    const generated = await generateGreeting({ roomId });
    greeting = generated.text;
    greetingMock = generated.mock;
  }

  try {
    const { callId, mock } = await placeOutboundCall({
      agentId: connection.agentId,
      toNumber,
      initialGreeting: greeting,
    });

    const conversationId = callConversationId(callId);
    const callEvent: CallEvent = {
      id: `call-${nanoid(8)}`,
      at: Date.now(),
      kind: "call",
      callId,
      direction: "outbound",
      status: "in-progress",
      from: connection.number,
      to: toNumber,
    };

    await startConversation({
      roomId,
      conversationId,
      greeting,
      trigger: "call",
      input: `Call to ${toNumber}`,
      seedEvents: [callEvent],
    });

    return NextResponse.json({
      callId,
      conversationId,
      greeting,
      mock: mock || greetingMock,
    });
  } catch (error) {
    console.error("Outbound call failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to place call",
      },
      { status: 502 }
    );
  }
}
