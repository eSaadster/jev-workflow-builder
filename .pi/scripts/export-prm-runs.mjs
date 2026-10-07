/**
 * Exports the last N completed runs of a workflow from its Liveblocks feeds
 * (one feed per run, one message per node) to .pi/prm/last-runs.json.
 *
 * Usage: node .pi/scripts/export-prm-runs.mjs [workflowId] [count]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Liveblocks } from "@liveblocks/node";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const workflowId = process.argv[2] ?? "ejFja9LgpU";
const count = Number(process.argv[3] ?? 5);
const roomId = `liveblocks:examples:nextjs-typesafe-workflow-builder:${workflowId}`;
const client = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });

const { data: feeds } = await client.getFeeds({ roomId });
const completed = feeds
  .filter((feed) => feed.metadata?.status === "complete")
  .sort((a, b) => Number(b.metadata.startedAt) - Number(a.metadata.startedAt))
  .slice(0, count);

const runs = [];

for (const feed of completed) {
  const { data: messages } = await client.getFeedMessages({ roomId, feedId: feed.feedId ?? feed.id });
  const nodes = messages.map((m) => m.data).sort((a, b) => a.startedAt - b.startedAt);
  const output = nodes.find((n) => n.nodeType === "output");
  const jev = nodes.find((n) => n.nodeType === "jev");

  runs.push({
    runId: feed.feedId ?? feed.id,
    input: feed.metadata.input,
    trigger: feed.metadata.trigger,
    startedAt: Number(feed.metadata.startedAt),
    completedAt: Number(feed.metadata.completedAt),
    answers: jev?.answers ?? {},
    firedHandles: jev?.firedHandles ?? [],
    output: output?.outputs ?? {},
    nodes: nodes.map(({ nodeId, nodeType, label, status, durationMs, mock, model, usage, error }) => ({
      nodeId, nodeType, label, status, durationMs, mock, model, usage, error,
    })),
  });
}

writeFileSync(new URL("../prm/last-runs.json", import.meta.url), JSON.stringify(runs, null, 2));
console.log(`${feeds.length} runs in room, exported ${runs.length} completed:`);
for (const r of runs) {
  console.log(`  ${new Date(r.startedAt).toISOString()} ${r.runId} ${r.input} (${((r.completedAt - r.startedAt) / 1000).toFixed(1)}s)`);
}
