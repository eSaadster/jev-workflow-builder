/**
 * Seeds the "Future Action Summit 2026 strict re-score" workflow into a
 * Liveblocks room. The graph lives in the echochange project so the rubric
 * sits next to the data it scores.
 *
 * Usage: node .pi/scripts/seed-summit-strict.mjs [workflowId]
 */
import { readFileSync } from "node:fs";
import { Liveblocks } from "@liveblocks/node";
import { mutateFlow } from "@liveblocks/react-flow/node";
import { nanoid } from "nanoid";
import {
  NAME,
  edges,
  nodes,
} from "/Users/saadfarooq/Documents/Projects/echochange/2026/summit-rescore-strict.workflow.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const EXAMPLE_ID = "nextjs-typesafe-workflow-builder";
const existingId = process.argv[2];
const workflowId = existingId ?? nanoid(10);
const roomId = `liveblocks:examples:${EXAMPLE_ID}:${workflowId}`;

const client = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });
const metadata = { app: EXAMPLE_ID, workflowId, name: NAME };

if (existingId) {
  await client.updateRoom(roomId, { metadata });
} else {
  await client.createRoom(roomId, { defaultAccesses: ["room:write"], metadata });
}

await mutateFlow({ client, roomId, storageKey: "flow" }, (flow) => {
  if (flow.edges.length) flow.removeEdges(flow.edges.map((e) => e.id));
  if (flow.nodes.length) flow.removeNodes(flow.nodes.map((n) => n.id));
});
await mutateFlow({ client, roomId, storageKey: "flow" }, (flow) => {
  flow.addNodes(nodes);
  flow.addEdges(edges);
});

console.log("workflowId:", workflowId);
console.log(`open: http://localhost:3000/w/${workflowId}`);
