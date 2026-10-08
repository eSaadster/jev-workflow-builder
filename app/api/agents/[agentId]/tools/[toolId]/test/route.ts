import { NextRequest, NextResponse } from "next/server";
import {
  getAgentRoomId,
  readAgentGraph,
} from "../../../../../../agent/server/storage";
import { executeToolCall, type ToolCache } from "../../../../../../agent/server/tools";

export const maxDuration = 60;

/**
 * Runs a saved tool against a real HTTP endpoint with test values — the same
 * executor the conversation uses. Works keyless against any public endpoint
 * (the seeded demo tool targets httpbin.org).
 *
 *   POST /api/agents/<agentId>/tools/<toolId>/test
 *   { "args": { "dot_number": "1234567" } }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string; toolId: string }> }
) {
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return NextResponse.json(
      { error: "Missing LIVEBLOCKS_SECRET_KEY" },
      { status: 403 }
    );
  }

  const { agentId, toolId } = await params;
  const exampleId = request.nextUrl.searchParams.get("exampleId");

  let body: { args?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};

  const { nodes } = await readAgentGraph(getAgentRoomId(agentId, exampleId));

  const toolbox = nodes.find((node) => node.type === "toolbox");
  const tool = toolbox?.data.tools.find((entry) => entry.id === toolId);

  if (!tool) {
    return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  }

  // Test runs get a fresh cache so cooldowns never mask a real request.
  const cache: ToolCache = {};
  const startedAt = Date.now();
  const outcome = await executeToolCall({ tool, args, scope: {}, cache });

  return NextResponse.json(
    {
      toolId,
      status: outcome.status,
      durationMs: Date.now() - startedAt,
      ...("error" in outcome ? { error: outcome.error } : {}),
      ...("outputs" in outcome ? { outputs: outcome.outputs } : {}),
      ...("raw" in outcome ? { raw: outcome.raw } : {}),
      ...("fromCache" in outcome ? { fromCache: outcome.fromCache } : {}),
    },
    { status: outcome.status === "error" ? 502 : 200 }
  );
}
