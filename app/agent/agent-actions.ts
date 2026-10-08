"use server";

import { redirect } from "next/navigation";
import {
  createAgent,
  listAgents,
  renameAgent,
  type AgentSummary,
} from "./server/storage";

function agentHref(agentId: string, exampleId: string | null) {
  const search = exampleId
    ? `?${new URLSearchParams({ exampleId }).toString()}`
    : "";
  return `/a/${agentId}${search}`;
}

export async function createAgentAction(
  exampleId: string | null
): Promise<void> {
  const agent = await createAgent(exampleId, { name: "Untitled agent" });
  redirect(agentHref(agent.agentId, exampleId));
}

export async function renameAgentAction(
  agentId: string,
  exampleId: string | null,
  name: string
): Promise<void> {
  await renameAgent(agentId, exampleId, name);
}

export async function listAgentsAction(
  exampleId: string | null
): Promise<AgentSummary[]> {
  return listAgents(exampleId);
}
