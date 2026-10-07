/**
 * Scores an X content schedule with the "X post scorer" workflow.
 *
 * Each schedule row runs through the workflow over the REST API. The Jev node
 * returns a continuous level (0..2) per Phoenix-head question; this script
 * turns those into a weighted score with the x-algorithm weights (see
 * lib/x-algorithm.mjs for the constants and the base-rate assumption), then
 * applies the schedule-level rules the ranker applies across posts.
 *
 * Needs the dev server running (npm run dev).
 *
 * Usage: node .pi/scripts/score-x-schedule.mjs <workflowId> [schedule.tsv]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  MULTIPLIERS,
  QUESTION_HEADS,
  WEIGHTS,
  levelMultiplier,
  scoreIndex,
  weightedScore,
} from "./lib/x-algorithm.mjs";

const workflowId = process.argv[2];
const schedulePath = process.argv[3] ?? ".pi/x-posts/schedule.tsv";
const BASE_URL = process.env.WORKFLOW_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = ".pi/x-posts";
const CONCURRENCY = 3;

if (!workflowId) {
  console.error("usage: node .pi/scripts/score-x-schedule.mjs <workflowId> [schedule.tsv]");
  process.exit(1);
}

/* --------------------------------- parse ---------------------------------- */

const LABELS = ["Week", "Day", "Topic", "Type", "Format", "Hook", "Angle", "Company tie-in", "CTA"];

const posts = readFileSync(schedulePath, "utf8")
  .split("\n")
  .map((line) => line.split("\t").map((cell) => cell.trim()))
  .filter((cells) => /^\d+$/.test(cells[0] ?? ""))
  .map((cells, index) => {
    const row = Object.fromEntries(LABELS.map((label, i) => [label, cells[i] ?? ""]));
    return {
      index,
      row,
      input: LABELS.map((label) => `${label}: ${row[label]}`).join("\n"),
    };
  });

console.log(`scoring ${posts.length} posts against workflow ${workflowId}`);

/* ---------------------------------- run ----------------------------------- */

// Runs are capped at 60s server-side, and a slow model call occasionally hits it.
async function runOne(post, attempt = 1) {
  try {
    return await runOnce(post);
  } catch (error) {
    if (attempt >= 2) throw error;
    console.warn(`  retrying (${error.message})`);
    return runOne(post, attempt + 1);
  }
}

async function runOnce(post) {
  const response = await fetch(`${BASE_URL}/api/workflows/${workflowId}/runs?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: post.input }),
  });
  const trace = await response.json();

  if (!response.ok || trace.status !== "complete") {
    throw new Error(`W${post.row.Week} ${post.row.Day}: ${trace.error ?? response.status}`);
  }

  const jev = trace.nodes.find((n) => n.nodeType === "jev");
  if (jev?.mock) console.warn("  warning: Jev ran against the mock (no TYPESAFE_API_KEY)");

  const levels = Object.fromEntries(
    Object.entries(jev?.answers ?? {}).map(([id, answer]) => [id, answer.score]),
  );
  const verdict = trace.output.ship?.length ? "ship" : "rework";
  const note = (trace.output.ship?.[0] ?? trace.output.rework?.[0] ?? "").trim();

  console.log(`  W${post.row.Week} ${post.row.Day}  ${verdict.padEnd(6)} ${scoreIndex(levels).toFixed(0)}`);
  return { ...post, runId: trace.runId, levels, verdict, note };
}

const results = [];
for (let i = 0; i < posts.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(posts.slice(i, i + CONCURRENCY).map((post) => runOne(post)))));
}

/* --------------------------------- score ---------------------------------- */

for (const r of results) {
  r.index100 = scoreIndex(r.levels);
  const { contributions } = weightedScore(r.levels);

  // The engagement question whose improvement to "above typical" would add
  // the most. Dwell is left out: its base rate is the weakest assumption and
  // it would win every time on head count alone.
  let best = null;
  for (const questionId of Object.keys(QUESTION_HEADS)) {
    if (questionId === "negative" || questionId === "dwell") continue;
    const gain = scoreIndex({ ...r.levels, [questionId]: 2 }) - r.index100;
    if (!best || gain > best.gain) best = { questionId, gain };
  }
  r.biggestLever = best;
  r.contributions = contributions;
}

const ranked = [...results].sort((a, b) => b.index100 - a.index100);

// Author diversity: when two of your posts are in one viewer's candidate set,
// the second is multiplied by (1 - floor) * decay^k + floor.
const { author_diversity_decay: decay, author_diversity_floor: floor } = MULTIPLIERS;
const secondPostMultiplier = (1 - floor) * decay + floor;

/* --------------------------------- report --------------------------------- */

const levelLabel = (x) => (x == null ? "–" : x < 0.67 ? "low" : x < 1.34 ? "typ" : "HIGH");
const cols = Object.keys(QUESTION_HEADS);

const lines = [
  "# X schedule score",
  "",
  `Workflow \`${workflowId}\`, ${results.length} posts, ${new Date().toISOString().slice(0, 10)}.`,
  "",
  "**Score** = Σ weight × P(action), with production weights from xai-org/x-algorithm and assumed base rates scaled 0.5×–2× by the Jev judgment. 100 = a typical B2B post. A uniform out-of-network factor (0.75) applies to every post for non-followers, so it doesn't change the order.",
  "",
  "| Rank | Wk | Day | Score | Verdict | " + cols.join(" | ") + " | Top engagement lever |",
  "|---|---|---|---|---|" + cols.map(() => "---").join("|") + "|---|",
  ...ranked.map(
    (r, i) =>
      `| ${i + 1} | ${r.row.Week} | ${r.row.Day} | ${r.index100.toFixed(0)} | ${r.verdict} | ` +
      cols.map((c) => levelLabel(r.levels[c])).join(" | ") +
      ` | ${r.biggestLever.questionId} (+${r.biggestLever.gain.toFixed(0)}) |`,
  ),
  "",
  "`negative` is feedback risk: `low` is good.",
  "",
  "## Schedule-level rules from the ranker",
  "",
  `- **48-hour window.** The AgeFilter drops posts older than ${MULTIPLIERS.age_filter_hours}h, so each post gets about two days of For You distribution.`,
  `- **Tue → Thu overlap.** Those posts are about 48h apart, so at the edge of that window a viewer can be served both. Author diversity then multiplies the lower-scoring one by ${secondPostMultiplier.toFixed(3)} (decay ${decay}, floor ${floor}). Posting Thu at least a few hours later in the day than Tue avoids it.`,
  "- **Original posts only.** OONRetweetReplyFilter drops replies and reposts from accounts the viewer doesn't follow, so a thread reply or a repost won't reach non-followers.",
  `- **New-author boost.** Accounts under ${MULTIPLIERS.cold_start_impression_threshold} impressions get lifted toward a target position; this helps early posts but doesn't change their order.`,
  `- **Video.** video view quality weight is ${WEIGHTS.vqv} and video open is ${WEIGHTS.video_open}. The talking-head and voice-memo formats earn ranking only through the text hook and the actions they drive.`,
  "",
  "## Notes per post",
  "",
  ...ranked.flatMap((r, i) => [
    `### ${i + 1}. W${r.row.Week} ${r.row.Day}: ${r.row.Topic} (${r.index100.toFixed(0)}, ${r.verdict})`,
    "",
    r.note,
    "",
  ]),
  "---",
  "",
  "Level → multiplier: " +
    [0, 1, 2].map((l) => `${l} → ${levelMultiplier(l)}×`).join(", ") +
    ". Base rates are in `.pi/scripts/lib/x-algorithm.mjs` and are assumptions, not values from X.",
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/report.md`, lines.join("\n"));
writeFileSync(
  `${OUT_DIR}/results.json`,
  JSON.stringify(
    ranked.map(({ index, input, ...r }) => r),
    null,
    2,
  ),
);
console.log(`wrote ${OUT_DIR}/report.md and ${OUT_DIR}/results.json`);
