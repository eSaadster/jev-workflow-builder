// Read-only recon: dump the current flow graph for a workflow room.
import { readFileSync } from "node:fs";
import { Liveblocks } from "@liveblocks/node";
import { mutateFlow } from "@liveblocks/react-flow/node";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const ROOM_PREFIX = "liveblocks:examples:nextjs-typesafe-workflow-builder";
const FLOW_STORAGE_KEY = "flow";

const client = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });

const roomId = `${ROOM_PREFIX}:${process.argv[2] ?? "alRCfXOHJO"}`;
console.log("room:", roomId);

let snapshot = { nodes: [], edges: [] };
await mutateFlow(
  { client, roomId, storageKey: FLOW_STORAGE_KEY },
  (flow) => {
    const json = flow.toJSON();
    snapshot = { nodes: [...json.nodes], edges: [...json.edges] };
  },
);

console.log("nodes:", snapshot.nodes.length, "edges:", snapshot.edges.length);
console.log(JSON.stringify(snapshot, null, 2));
