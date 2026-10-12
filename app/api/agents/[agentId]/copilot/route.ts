import { NextRequest, NextResponse } from "next/server";
import {
  processCopilotTurn,
  startCopilotConversation,
} from "../../../../agent/server/copilot";
import { getAgent, getAgentRoomId } from "../../../../agent/server/storage";

// One copilot turn is a Haiku tool loop (up to 12 steps: graph edits, tests,
// research); keep the platform limit above the copilot's 90s budget.
export const maxDuration = 120;

/**
 * Drives the build copilot — the chat that edits the agent graph.
 *
 *   POST /api/agents/<agentId>/copilot
 *   { "text": "add a callback-request scenario and test it" }
 *   { "conversationId": "copilot-…", "text": "now wire the jev yes handle into it" }
 *
 * Without a `conversationId` a new copilot chat starts. Tool calls (graph
 * edits, test conversations, web research) stream into the feed and onto the
 * canvas as they run.
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

  let body: { conversationId?: unknown; text?: unknown } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body just starts a new chat below.
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (text === "") {
    return NextResponse.json(
      { error: "`text` must be a non-empty string" },
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

  const roomId = getAgentRoomId(agentId, exampleId);

  const conversationId =
    typeof body.conversationId === "string" &&
    body.conversationId.startsWith("copilot-")
      ? body.conversationId
      : (await startCopilotConversation({ roomId })).conversationId;

  try {
    const result = await processCopilotTurn({
      roomId,
      conversationId,
      text,
    });

    return NextResponse.json(
      {
        conversationId,
        reply: result.reply,
        ...(result.error ? { error: result.error } : {}),
      },
      { status: result.error ? 500 : 200 }
    );
  } catch (error) {
    console.error("Copilot request failed", error);
    return NextResponse.json({ error: "Copilot request failed" }, { status: 500 });
  }
}
