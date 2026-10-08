import { NextRequest, NextResponse } from "next/server";
import { getAgent, getAgentRoomId } from "../../../../agent/server/storage";
import { startConversation } from "../../../../agent/server/turn-engine";

// One turn is a Jev batch + an LLM reply (possibly with tool calls) +
// extraction; keep the platform limit above TURN_TIMEOUT_MS (90s).
export const maxDuration = 120;

/**
 * Starts a test conversation for an agent.
 *
 *   POST /api/agents/<agentId>/conversations
 *   { "opening": "optional first caller message" }
 *
 * Responds `{ conversationId }`. The conversation streams into a Liveblocks
 * feed in the agent's room (visible in the side panel for everyone). Without
 * an `opening`, the agent speaks first.
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

  let body: { opening?: unknown } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Empty body is fine: the agent opens.
  }

  const opening =
    typeof body.opening === "string" && body.opening.length < 4_000
      ? body.opening
      : undefined;

  const agent = await getAgent(agentId, exampleId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    const { conversationId } = await startConversation({
      roomId: getAgentRoomId(agentId, exampleId),
      opening,
    });
    return NextResponse.json({ conversationId, status: "running" });
  } catch (error) {
    console.error("Failed to start conversation", error);
    return NextResponse.json(
      { error: "Failed to start conversation" },
      { status: 500 }
    );
  }
}
