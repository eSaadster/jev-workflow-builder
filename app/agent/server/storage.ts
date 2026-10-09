import "server-only";

import { mutateFlow } from "@liveblocks/react-flow/node";
import { nanoid } from "nanoid";
import { liveblocks } from "../../workflow/server/liveblocks";
import {
  createBlankAgentGraph,
  createDemoAgentGraph,
  DEMO_AGENT_NAME,
} from "../demo";
import {
  AGENT_EXAMPLE_ID,
  AGENT_FLOW_STORAGE_KEY,
  AGENT_ROOM_ID_PREFIX,
  type AgentEdge,
  type AgentGraphNode,
} from "../shared";
import type { AgentPhoneConnection } from "./agentphone";

/** Room metadata key holding the AgentPhone connection JSON. */
export const AGENTPHONE_METADATA_KEY = "agentphone";

export type AgentSummary = {
  agentId: string;
  name: string;
  createdAt: number;
  lastConnectionAt: number | null;
};

function getAppKey(exampleId: string | null | undefined): string {
  return exampleId ? `${AGENT_EXAMPLE_ID}-${exampleId}` : AGENT_EXAMPLE_ID;
}

export function getAgentRoomId(
  agentId: string,
  exampleId: string | null | undefined
): string {
  const prefix = exampleId
    ? `${AGENT_ROOM_ID_PREFIX}-${exampleId}`
    : AGENT_ROOM_ID_PREFIX;
  return `${prefix}:${agentId}`;
}

function getMetadataString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function toSummary(room: {
  metadata: Record<string, string | string[]>;
  createdAt: string | Date;
  lastConnectionAt?: string | Date | null;
}): AgentSummary {
  return {
    agentId: getMetadataString(room.metadata.agentId),
    name: getMetadataString(room.metadata.name) || "Untitled agent",
    createdAt: new Date(room.createdAt).getTime(),
    lastConnectionAt: room.lastConnectionAt
      ? new Date(room.lastConnectionAt).getTime()
      : null,
  };
}

export async function listAgents(
  exampleId: string | null | undefined
): Promise<AgentSummary[]> {
  const { data } = await liveblocks.getRooms({
    query: { metadata: { app: getAppKey(exampleId) } },
    limit: 50,
  });

  return data
    .map(toSummary)
    .filter((agent) => agent.agentId !== "")
    .sort(
      (a, b) =>
        (b.lastConnectionAt ?? b.createdAt) -
        (a.lastConnectionAt ?? a.createdAt)
    );
}

export async function getAgent(
  agentId: string,
  exampleId: string | null | undefined
): Promise<AgentSummary | null> {
  try {
    const room = await liveblocks.getRoom(getAgentRoomId(agentId, exampleId));
    return toSummary(room);
  } catch {
    return null;
  }
}

export async function createAgent(
  exampleId: string | null | undefined,
  options: { name?: string; seedDemo?: boolean } = {}
): Promise<AgentSummary> {
  const agentId = nanoid(10);
  const name = options.name ?? (options.seedDemo ? DEMO_AGENT_NAME : "Untitled agent");
  const room = await liveblocks.createRoom(
    getAgentRoomId(agentId, exampleId),
    {
      defaultAccesses: ["room:write"],
      metadata: { app: getAppKey(exampleId), agentId, name },
    }
  );

  const { nodes, edges } = options.seedDemo
    ? createDemoAgentGraph()
    : createBlankAgentGraph();

  await mutateFlow<AgentGraphNode, AgentEdge>(
    { client: liveblocks, roomId: getAgentRoomId(agentId, exampleId), storageKey: AGENT_FLOW_STORAGE_KEY },
    (flow) => {
      flow.addNodes(nodes);
      flow.addEdges(edges);
    }
  );

  return {
    agentId,
    name,
    createdAt: new Date(room.createdAt).getTime(),
    lastConnectionAt: null,
  };
}

export async function renameAgent(
  agentId: string,
  exampleId: string | null | undefined,
  name: string
): Promise<void> {
  await liveblocks.updateRoom(getAgentRoomId(agentId, exampleId), {
    metadata: { name: name.trim() || "Untitled agent" },
  });
}

/** Seeds the demo agent once per app key, like the summit workflow. */
export async function ensureDemoAgent(
  exampleId: string | null | undefined
): Promise<void> {
  const agents = await listAgents(exampleId);

  if (agents.some((agent) => agent.name === DEMO_AGENT_NAME)) {
    return;
  }

  await createAgent(exampleId, { seedDemo: true });
}

/**
 * Reads a point-in-time snapshot of the agent graph (start, agent, toolbox,
 * scenarios, dispositions) from Storage.
 */
export async function readAgentGraph(roomId: string): Promise<{
  nodes: AgentGraphNode[];
  edges: AgentEdge[];
}> {
  let snapshot: { nodes: AgentGraphNode[]; edges: AgentEdge[] } = {
    nodes: [],
    edges: [],
  };

  await mutateFlow<AgentGraphNode, AgentEdge>(
    { client: liveblocks, roomId, storageKey: AGENT_FLOW_STORAGE_KEY },
    (flow) => {
      const json = flow.toJSON();
      snapshot = { nodes: [...json.nodes], edges: [...json.edges] };
    }
  );

  return snapshot;
}

/* -------------------------------------------------------------------------- */
/*                        AgentPhone connection (metadata)                     */
/* -------------------------------------------------------------------------- */

/**
 * The AgentPhone connection lives in room metadata (a JSON string) so both the
 * server routes and the room's clients can see which number runs this agent.
 */
export async function getAgentPhoneConnection(
  agentId: string,
  exampleId: string | null | undefined
): Promise<AgentPhoneConnection | null> {
  try {
    const room = await liveblocks.getRoom(getAgentRoomId(agentId, exampleId));
    const raw = getMetadataString(
      room.metadata[AGENTPHONE_METADATA_KEY] as string | string[] | undefined
    );

    if (raw === "") {
      return null;
    }

    const connection = JSON.parse(raw) as AgentPhoneConnection;
    return connection.agentId && connection.number ? connection : null;
  } catch {
    return null;
  }
}

export async function setAgentPhoneConnection(
  agentId: string,
  exampleId: string | null | undefined,
  connection: AgentPhoneConnection | null
): Promise<void> {
  await liveblocks.updateRoom(getAgentRoomId(agentId, exampleId), {
    metadata: {
      [AGENTPHONE_METADATA_KEY]: connection ? JSON.stringify(connection) : "",
    },
  });
}
