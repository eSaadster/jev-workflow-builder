import { NextRequest, NextResponse } from "next/server";
import { getAgent, getAgentRoomId } from "../../../../../../agent/server/storage";
import { processTurn } from "../../../../../../agent/server/turn-engine";

export const maxDuration = 120;

/**
 * Sends one caller turn to a conversation.
 *
 *   POST /api/agents/<agentId>/conversations/<conversationId>/messages
 *   { "text": "yeah, we run about twelve trucks out of Elizabeth" }
 *
 * Or end the conversation: `{ "end": true }`. Responds with the agent's reply
 * for this turn; the full transcript also streams into the Liveblocks feed.
 */
export async function POST(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ agentId: string; conversationId: string }> }
) {
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return NextResponse.json(
      { error: "Missing LIVEBLOCKS_SECRET_KEY" },
      { status: 403 }
    );
  }

  const { agentId, conversationId } = await params;
  const exampleId = request.nextUrl.searchParams.get("exampleId");

  let body: { text?: unknown; end?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: 'Body must be JSON: { "text": string } or { "end": true }' },
      { status: 400 }
    );
  }

  const text = typeof body.text === "string" ? body.text : "";
  const end = body.end === true;

  if (!end && text.trim() === "") {
    return NextResponse.json(
      { error: "`text` must be a non-empty string (or pass `end: true`)" },
      { status: 400 }
    );
  }

  if (text.length > 4_000) {
    return NextResponse.json(
      { error: "`text` must be under 4,000 characters" },
      { status: 413 }
    );
  }

  const agent = await getAgent(agentId, exampleId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    const result = await processTurn({
      roomId: getAgentRoomId(agentId, exampleId),
      conversationId,
      text: text.trim() === "" ? null : text,
      end,
    });

    return NextResponse.json(
      {
        conversationId,
        reply: result.reply,
        ended: result.ended,
        ...(result.error ? { error: result.error } : {}),
      },
      { status: result.error ? 500 : 200 }
    );
  } catch (error) {
    console.error("Turn failed", error);
    return NextResponse.json({ error: "Turn failed" }, { status: 500 });
  }
}
