/**
 * Seeds the "X post scorer" workflow into a new Liveblocks room (or updates an
 * existing one when a workflowId is passed).
 *
 * Modeled on the For You ranker in xai-org/x-algorithm: Phoenix predicts a
 * probability per action, and RankingScorer sums weight × P(action). Here a Jev
 * node judges, for one planned post, how each high-weight action compares to a
 * typical B2B post (below / typical / above). Each question maps to one or more
 * Phoenix heads; the numeric composite is computed from the run trace by
 * score-x-schedule.mjs, because templates only expose the rounded level.
 *
 * Usage: node .pi/scripts/seed-x-post-scorer.mjs [workflowId]
 */
import { readFileSync } from "node:fs";
import { Liveblocks } from "@liveblocks/node";
import { mutateFlow } from "@liveblocks/react-flow/node";
import { nanoid } from "nanoid";

/* ----------------------------------- env ---------------------------------- */

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
const ROOM_PREFIX = `liveblocks:examples:${EXAMPLE_ID}`;
const FLOW_STORAGE_KEY = "flow";
const IN_HANDLE = "in";
const OUT_HANDLE = "out";
const MODEL = "deepseek-v4.1-flash";
const NAME = "X post scorer";

const existingId = process.argv[2];
const workflowId = existingId ?? nanoid(10);
const roomId = `${ROOM_PREFIX}:${workflowId}`;

/* --------------------------------- content -------------------------------- */

const SAMPLE_INPUT = `Week: 2
Day: Thu
Topic: Why Most AI Sales Agents Fail After the Demo
Type: Pain Point
Format: 🎥 Talking Head
Hook: "A great AI demo takes 30 seconds. What happens when you put it into a real sales team?"
Angle: Production AI requires data, QA, routing, monitoring and escalation
Company tie-in: Phi builds AI into operating systems rather than demos
CTA: "Would your AI survive Monday morning?"`;

const AUDIENCE =
  "The audience is B2B go-to-market people on X (founders, sales leaders, RevOps, growth) who mostly do NOT follow this account, so the post is judged as an out-of-network recommendation in their For You feed.";

// 0 = below typical, 1 = typical, 2 = above typical. The batch script reads
// the continuous expected level and maps it to 0.5x..2x an assumed base rate.
const relativeLevels = (below, typical, above) => [
  { key: "below_typical", description: below },
  { key: "typical", description: typical },
  { key: "above_typical", description: above },
];

/**
 * Each question stands in for one or more Phoenix heads. Default weights from
 * home-mixer/params/param.rs are noted per question.
 */
const JEV_QUESTIONS = [
  {
    id: "reply",
    type: "score",
    instructions: `${AUDIENCE} How likely is a reader to REPLY to the post described in \`input\`, compared with a typical B2B post? (reply weight 5.0, plus 15.0 when viewer and author follow each other.) Replies come from a specific, answerable question, a take people want to disagree with, or a prompt for their own experience. A generic rhetorical question or a CTA that asks for effort earns fewer replies.`,
    levels: relativeLevels(
      "Nothing specific to answer, or the question is rhetorical.",
      "An answerable question but a familiar one.",
      "A specific, low-effort question or contrarian claim readers will want to answer.",
    ),
  },
  {
    id: "quote",
    type: "score",
    instructions: `${AUDIENCE} How likely is a reader to QUOTE-post this, adding their own take, compared with a typical B2B post? (quote weight 5.0.) Quotes follow a clear stance people can agree or argue with in public.`,
    levels: relativeLevels(
      "No stance to react to.",
      "Some stance, but a consensus view.",
      "A sharp, debatable claim people will want to put their name next to.",
    ),
  },
  {
    id: "share_dm",
    type: "score",
    instructions: `${AUDIENCE} How likely is a reader to SEND this to a colleague by DM or share it, compared with a typical B2B post? (share via DM 5.0, share 2.0.) People forward posts that name a problem their team has right now, so they can say "this is us".`,
    levels: relativeLevels(
      "Too abstract to forward to anyone.",
      "Relevant, but not about a specific team problem.",
      "Names a concrete problem a reader would forward to their boss or team.",
    ),
  },
  {
    id: "bookmark_link",
    type: "score",
    instructions: `${AUDIENCE} How likely is a reader to COPY THE LINK to keep or share it elsewhere (Slack, a doc, a newsletter), compared with a typical B2B post? (share via copy link 20.0, the largest positive weight.) Reference-worthy posts carry a framework, checklist, number or model someone will want to come back to.`,
    levels: relativeLevels(
      "Opinion only, nothing to reuse.",
      "Some reusable idea, loosely stated.",
      "A named framework, checklist or concrete model worth saving.",
    ),
  },
  {
    id: "follow",
    type: "score",
    instructions: `${AUDIENCE} How likely is a reader who does not follow this account to FOLLOW it after seeing the post, compared with a typical B2B post? (follow author 4.0.) Follows come from a distinct point of view the reader expects more of. A post that reads as a product pitch earns fewer.`,
    levels: relativeLevels(
      "Reads as a pitch or as generic AI commentary.",
      "Competent but interchangeable with other accounts.",
      "A distinct, credible point of view the reader wants more of.",
    ),
  },
  {
    id: "like_repost",
    type: "score",
    instructions: `${AUDIENCE} How likely is a reader to LIKE or REPOST this, compared with a typical B2B post? (favorite 0.5, repost 1.0: low weights, but common actions.)`,
    levels: relativeLevels(
      "Forgettable.",
      "Agreeable, low-friction.",
      "A line people will want to endorse or amplify.",
    ),
  },
  {
    id: "dwell",
    type: "score",
    instructions: `${AUDIENCE} How long will a reader stop on this post, compared with a typical B2B post? (dwell 0.05, dwell time 0.004 per second, not dwelled -0.02, video view quality 0.0 and video open 0.07.) On X, video view quality currently carries no weight, so the format only helps when the hook makes someone stop scrolling and open it. Judge whether the opening line earns the stop within the first second, and whether the format fits a text-first feed: a voice memo is not a native X post format and has to be uploaded as a video with captions.`,
    levels: relativeLevels(
      "Easy to scroll past: weak opener, or a format that needs sound or context to make sense.",
      "A readable opener; some readers stop.",
      "The first line forces a stop, and the post still makes sense muted.",
    ),
  },
  {
    id: "negative",
    type: "score",
    instructions: `${AUDIENCE} How likely are readers to tap "Not interested", mute or block the author after seeing this, compared with a typical B2B post? (not interested -43.2, mute -58.8, block -31.2, report -234.) Negative feedback is triggered by overt self-promotion, engagement bait, AI hype, and repetition of a take the reader has seen many times.`,
    levels: relativeLevels(
      "Low risk: useful on its own, promotion is light.",
      "Some risk: familiar AI-and-GTM framing, or a visible pitch.",
      "High risk: reads as hype, bait or an ad.",
    ),
  },
];

const SCORE_CONTEXT = `Planned post:
{{input}}

Jev judgments versus a typical B2B post:
- Reply: {{answers.reply}}
- Quote: {{answers.quote}}
- Share by DM: {{answers.share_dm}}
- Copy link / save: {{answers.bookmark_link}}
- Follow: {{answers.follow}}
- Like / repost: {{answers.like_repost}}
- Dwell: {{answers.dwell}}
- Negative feedback risk: {{answers.negative}}`;

const RANKING_NOTES = `How the For You ranker weighs actions (production defaults): copy link 20, reply 5, quote 5, share via DM 5, follow 4, share 2, repost 1, like 0.5; not interested -43.2, mute -58.8, block -31.2, report -234. The weights apply to predicted probabilities, not counts. Video view quality carries no weight. Posts older than 48 hours are filtered out, and replies or reposts from accounts the viewer does not follow are dropped, so each post must stand alone as an original post.`;

const SHIP_PROMPT = `${SCORE_CONTEXT}

${RANKING_NOTES}

This post cleared the screen: strong reply pull and low negative-feedback risk. Write a short ship note for the person posting it.
1. One sentence on why it should rank well, naming the action it will earn most.
2. The one change that would lift it further, aimed at the highest-weight action it is weakest on (usually copy link / save, or DM share).
3. A ready-to-post opening line for X, under 280 characters, that works muted and does not depend on the video.
Plain text.`;

const REWORK_PROMPT = `${SCORE_CONTEXT}

${RANKING_NOTES}

This post did not clear the screen: either reply pull is not strong, or negative-feedback risk is not low. Write a short rework note.
1. Name the check that failed: if Reply is above_typical, it is negative-feedback risk; if Negative feedback risk is below_typical, it is reply pull; otherwise both. Say why in one or two sentences, citing the hook or CTA.
2. A rewritten hook and CTA that fix it. Make the question specific and low-effort to answer, cut the pitch, and keep the company tie-in to one clause at most.
3. A ready-to-post opening line for X, under 280 characters, that works muted.
Plain text.`;

const OUTPUT_PROPERTIES = [
  { id: "prop-ship", name: "ship" },
  { id: "prop-rework", name: "rework" },
];

/* ---------------------------------- graph --------------------------------- */

const h = (questionId, key) => `q:${questionId}:${key}`;

const nodes = [
  {
    id: "input",
    type: "input",
    position: { x: 0, y: 300 },
    deletable: false,
    data: { label: "Planned X post", sample: SAMPLE_INPUT },
  },
  {
    id: "jev-actions",
    type: "jev",
    position: { x: 380, y: 300 },
    data: {
      label: "Predicted actions (Phoenix heads)",
      questions: JEV_QUESTIONS,
      activation: "any",
    },
  },
  {
    id: "llm-ship",
    type: "llm",
    position: { x: 900, y: 80 },
    data: {
      label: "Ship note",
      model: MODEL,
      // AND: reply above typical AND negative risk below typical.
      activation: "all",
      system:
        "You edit B2B posts for X. You know how the For You ranker weighs actions. Be concrete and terse.",
      prompt: SHIP_PROMPT,
    },
  },
  {
    id: "llm-rework",
    type: "llm",
    position: { x: 900, y: 520 },
    data: {
      label: "Rework note",
      model: MODEL,
      // OR: reply not above typical, or negative risk not below typical.
      activation: "any",
      system:
        "You edit B2B posts for X. You know how the For You ranker weighs actions. Be concrete and terse.",
      prompt: REWORK_PROMPT,
    },
  },
  {
    id: "output",
    type: "output",
    position: { x: 1360, y: 300 },
    deletable: false,
    data: {
      label: "Output",
      activation: "any",
      properties: OUTPUT_PROPERTIES,
    },
  },
];

/**
 * BRANCH DISJOINTNESS
 *
 * `reply` and `negative` are score questions, and each fires exactly one level
 * handle. Ship needs reply = 2 AND negative = 0. Rework fires on reply 0 or 1,
 * or on negative 1 or 2, which is exactly the complement. Every post lands in
 * one output property.
 */
const WIRES = [
  ["input", OUT_HANDLE, "jev-actions", IN_HANDLE],

  ["jev-actions", h("reply", "2"), "llm-ship", IN_HANDLE],
  ["jev-actions", h("negative", "0"), "llm-ship", IN_HANDLE],

  ["jev-actions", h("reply", "0"), "llm-rework", IN_HANDLE],
  ["jev-actions", h("reply", "1"), "llm-rework", IN_HANDLE],
  ["jev-actions", h("negative", "1"), "llm-rework", IN_HANDLE],
  ["jev-actions", h("negative", "2"), "llm-rework", IN_HANDLE],

  ["llm-ship", OUT_HANDLE, "output", "prop-ship"],
  ["llm-rework", OUT_HANDLE, "output", "prop-rework"],
];

const edges = WIRES.map(([source, sourceHandle, target, targetHandle]) => ({
  id: `e-${source}-${sourceHandle}-${target}`.replace(/[^\w-]/g, "_"),
  type: "smoothstep",
  source,
  sourceHandle,
  target,
  targetHandle,
  data: {},
}));

/* ------------------------------ sanity checks ----------------------------- */

const nodeIds = new Set(nodes.map((n) => n.id));
const edgeIds = new Set(edges.map((e) => e.id));
if (edgeIds.size !== edges.length) throw new Error("duplicate edge id");

for (const [source, sourceHandle, target, targetHandle] of WIRES) {
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error(`wire references a missing node: ${source} -> ${target}`);
  }
  if (target === "output" && !OUTPUT_PROPERTIES.some((p) => p.id === targetHandle)) {
    throw new Error(`wire targets an unknown output property: ${targetHandle}`);
  }
  if (source === "jev-actions") {
    const [, questionId, key] = sourceHandle.split(":");
    const q = JEV_QUESTIONS.find((x) => x.id === questionId);
    if (!q || !q.levels[Number(key)]) {
      throw new Error(`handle ${sourceHandle} is not a real ${questionId} level`);
    }
  }
}

// Ship and rework must partition every (reply, negative) pair.
const firesInto = (target, reply, negative) => {
  const incoming = WIRES.filter(([, , t]) => t === target).map(([, sh]) => sh);
  const fired = incoming.filter(
    (sh) => sh === h("reply", String(reply)) || sh === h("negative", String(negative)),
  );
  const mode = nodes.find((n) => n.id === target).data.activation;
  return mode === "all" ? fired.length === incoming.length : fired.length > 0;
};
for (const reply of [0, 1, 2]) {
  for (const negative of [0, 1, 2]) {
    const ship = firesInto("llm-ship", reply, negative);
    const rework = firesInto("llm-rework", reply, negative);
    if (ship === rework) {
      throw new Error(`reply=${reply} negative=${negative} fires ship=${ship} rework=${rework}`);
    }
  }
}

/* ---------------------------------- write --------------------------------- */

const client = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });

if (!existingId) {
  await client.createRoom(roomId, {
    defaultAccesses: ["room:write"],
    metadata: { app: EXAMPLE_ID, workflowId, name: NAME },
  });
}

console.log("workflowId:", workflowId);
console.log("nodes:", nodes.length, "edges:", edges.length);

await mutateFlow({ client, roomId, storageKey: FLOW_STORAGE_KEY }, (flow) => {
  const staleEdges = flow.edges.map((e) => e.id).filter((id) => !edgeIds.has(id));
  const staleNodes = flow.nodes.map((n) => n.id).filter((id) => !nodeIds.has(id));
  if (staleEdges.length) flow.removeEdges(staleEdges);
  if (staleNodes.length) flow.removeNodes(staleNodes);

  flow.addNodes(nodes);
  flow.addEdges(edges);
});

console.log(`open: http://localhost:3000/w/${workflowId}`);
