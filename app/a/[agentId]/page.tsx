import { notFound } from "next/navigation";
import { AgentApp } from "../../agent/agent-app";
import { getAgent, getAgentRoomId } from "../../agent/server/storage";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function getParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { agentId } = await params;
  const search = await searchParams;
  // Used when deploying an example on liveblocks.io. Ignore locally.
  const exampleId = getParam(search, "exampleId");

  const agent = await getAgent(agentId, exampleId);

  if (!agent) {
    notFound();
  }

  return (
    <AgentApp
      roomId={getAgentRoomId(agentId, exampleId)}
      agent={agent}
      exampleId={exampleId}
    />
  );
}
