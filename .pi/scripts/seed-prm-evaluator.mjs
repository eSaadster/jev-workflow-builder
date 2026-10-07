/**
 * Seeds the "PRM vendor evaluator" workflow into a Liveblocks room: one run per
 * candidate that could replace Channelscaler (Euler, Impartner, Salesforce
 * PRM, ZINFI, ...). The run input is the vendor name only, because the web
 * search queries template `{{input}}`. Requirements live in prompts.
 *
 * Four TinyFish searches (portal & onboarding, Salesforce & deal reg, MDF &
 * distributors, AI assistant) each fetch their top pages. One Jev node grades
 * every evaluation area from that evidence, and a hard-requirements gate routes
 * to a shortlist memo or a disqualify note. A scorecard and a build-vs-buy note
 * always run. score-prm-vendors.mjs runs a vendor list and compares them.
 *
 * Usage: node .pi/scripts/seed-prm-evaluator.mjs [workflowId]
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
const ANY_HANDLE = "any";
const MODEL = "deepseek-v4.1-flash";
const NAME = "PRM vendor evaluator (Channelscaler replacement)";

const existingId = process.argv[2];
const workflowId = existingId ?? nanoid(10);
const roomId = `${ROOM_PREFIX}:${workflowId}`;

/* --------------------------------- content -------------------------------- */

const SAMPLE_INPUT = "Impartner";

const CONTEXT = `The input is web evidence (search snippets and fetched pages) about one partner relationship management (PRM) product. We are replacing Channelscaler (formerly Allbound + Channel Mechanics) as our PRM. Our partner base mixes resellers, MSPs, distributors and technology partners. Salesforce is our CRM and must stay the system of record. Judge only from the evidence: vendor marketing claims count as partial unless docs, reviews or customer stories confirm the detail. Absent evidence is not_evidenced, not a guess. A competitor's own comparison page is not evidence for or against the vendor it compares.`;

// 0 = not evidenced, 1 = partial, 2 = strong. score-prm-vendors.mjs weights
// the expected level per area.
const levels = (none, partial, strong) => [
  { key: "not_evidenced", description: none },
  { key: "partial", description: partial },
  { key: "strong", description: strong },
];

/**
 * One score question per evaluation area. `weight` is not sent to TypeSafe;
 * the batch script reads it from here to build the composite (sums to 100).
 */
export const AREAS = [
  {
    id: "partner_experience",
    weight: 10,
    label: "Partner experience & UI",
    instructions: `${CONTEXT} How good is the partner-facing experience: portal UI, navigation, mobile, personalization by partner type and tier, and what partners say about it in reviews?`,
    levels: levels(
      "Nothing about the portal UI or partner feedback.",
      "A portal exists and is described, but no partner feedback or specifics on personalization.",
      "Reviews or customer stories praise the partner portal; personalized by partner type/tier.",
    ),
  },
  {
    id: "onboarding",
    weight: 12,
    label: "Partner onboarding",
    instructions: `${CONTEXT} How well does it handle partner onboarding: applications, approval workflow, contract/agreement status, duplicate prevention and domain matching, account and contact creation, and guided onboarding journeys for reseller, MSP, distributor and technology-partner models?`,
    levels: levels(
      "No onboarding detail.",
      "Applications and onboarding journeys mentioned, without approvals, contracts or duplicate handling.",
      "Configurable application-to-approval flow with agreements, duplicate/domain checks and journeys per partner type.",
    ),
  },
  {
    id: "enablement",
    weight: 7,
    label: "Partner enablement",
    instructions: `${CONTEXT} How strong is partner enablement: content library, training/LMS, certifications, playbooks, co-branded assets and campaign support?`,
    levels: levels(
      "No enablement detail.",
      "Content library or training, but no certifications or LMS depth.",
      "Built-in or integrated LMS with certifications, plus content, playbooks and co-marketing assets.",
    ),
  },
  {
    id: "mdf",
    weight: 8,
    label: "MDF management",
    instructions: `${CONTEXT} How well does it manage marketing development funds (MDF) and incentives: fund allocation, requests, approvals, claims with proof of performance, payouts, and rebates/SPIFs?`,
    levels: levels(
      "No MDF or incentives capability shown.",
      "MDF or incentives mentioned without the request-approve-claim-pay cycle.",
      "Full MDF lifecycle (allocate, request, approve, claim with proof, pay) plus incentive programs.",
    ),
  },
  {
    id: "sfdc_integration",
    weight: 15,
    label: "Salesforce integration",
    instructions: `${CONTEXT} How deep is the Salesforce integration: bi-directional sync, field mapping including custom objects, duplicate prevention, error handling, API-limit handling, and Salesforce staying the system of record? Native-on-Salesforce products count as strong only if partner data lives in standard/custom Salesforce objects.`,
    levels: levels(
      "No Salesforce integration detail.",
      "A Salesforce connector exists, but sync direction, custom objects or system-of-record handling is unclear or one-way.",
      "Bi-directional sync with custom-object mapping and Salesforce as system of record, or native on Salesforce.",
    ),
  },
  {
    id: "deal_registration",
    weight: 15,
    label: "Deal registration",
    instructions: `${CONTEXT} How strong is deal registration: sourced vs. co-sell, linking to existing vs. new Salesforce opportunities, approval routing, territory assignment, provisional approval, extensions, expiration, automated denial rules, conflict detection and audit history?`,
    levels: levels(
      "No deal registration detail.",
      "Basic deal registration with approval, but no routing rules, expiration/denial automation or opportunity linkage.",
      "Configurable routing with provisional approval, expiration, extensions, auto-denial, conflict checks and opportunity linkage.",
    ),
  },
  {
    id: "ai_assistant",
    weight: 10,
    label: "AI assistant for partners",
    instructions: `${CONTEXT} Does it give partners an AI chatbot or agent that answers their questions in real time (program rules, deal status, content, incentives), grounded in the program's own data, and does AI automate partner-ops work?`,
    levels: levels(
      "No partner-facing AI.",
      "AI for internal analytics or content, or a generic chatbot not grounded in program data.",
      "A partner-facing AI assistant answering from program data and deal status, plus agentic automation of partner ops.",
    ),
  },
  {
    id: "distributor_support",
    weight: 10,
    label: "Distributor & multi-tier",
    instructions: `${CONTEXT} How well does it support distributors and multi-tier channels: named-user provisioning, distributor-specific roles, many users under one distributor, user offboarding, and visibility rules between distributor and reseller? Account-level activation alone is not enough.`,
    levels: levels(
      "No distributor or multi-tier detail.",
      "Two-tier or distributor support mentioned without user-level roles and visibility.",
      "Multi-tier with named users, distributor roles, visibility rules and offboarding.",
    ),
  },
  {
    id: "reporting",
    weight: 5,
    label: "Reporting",
    instructions: `${CONTEXT} How strong is reporting: partner-sourced pipeline, deal-reg metrics, partner performance, incentives, user access and history, export and API access?`,
    levels: levels(
      "No reporting detail.",
      "Dashboards mentioned without pipeline attribution, export or API.",
      "Partner pipeline and performance reporting with export/API access.",
    ),
  },
  {
    id: "admin_controls",
    weight: 5,
    label: "Admin & controls",
    instructions: `${CONTEXT} How strong are administration and controls: granular roles, approval permissions, audit logs, configurable workflows without code, SSO/MFA, data retention and bulk updates?`,
    levels: levels(
      "No admin or security detail.",
      "Some of roles, SSO or workflow config, not audit logs or bulk updates.",
      "Granular roles, audit logs, no-code workflows, SSO/MFA and bulk admin.",
    ),
  },
  {
    id: "migration_risk",
    weight: 3,
    label: "Migration & vendor risk",
    instructions: `${CONTEXT} How low is the migration and vendor risk: migration tooling for IDs, statuses and history, coexistence during cutover, support/SLA, company maturity and customer base, and implementation effort? Strong means low risk.`,
    levels: levels(
      "No evidence on migration, support or vendor maturity.",
      "An established vendor or some services, but no migration tooling or history-preserving approach shown.",
      "Proven migrations from other PRMs, services for cutover, and an established enterprise customer base.",
    ),
  },
];

/**
 * Hard requirements, one yes/no each so a borderline vendor does not flip on
 * one blended probability. Shortlist needs all three yes; any no disqualifies.
 */
const GATES = [
  {
    id: "gate_sfdc_sor",
    type: "noul",
    instructions: `${CONTEXT} Does the evidence show bi-directional Salesforce sync (or native Salesforce data) that keeps Salesforce as the system of record for partner accounts, contacts and opportunities?`,
    threshold: 0.6,
  },
  {
    id: "gate_dealreg_lifecycle",
    type: "noul",
    instructions: `${CONTEXT} Does the evidence show deal registration with configurable approval routing AND expiration or denial rules?`,
    threshold: 0.6,
  },
  {
    id: "gate_onboarding_approvals",
    type: "noul",
    instructions: `${CONTEXT} Does the evidence show partner onboarding with an application approval workflow?`,
    threshold: 0.6,
  },
];

const JEV_QUESTIONS = [
  ...AREAS.map(({ id, instructions, levels }) => ({
    id,
    type: "score",
    instructions,
    levels,
  })),
  ...GATES,
];

const SCORE_CONTEXT = `Area grades from the evidence (not_evidenced / partial / strong), with area weights out of 100:
${AREAS.map((a) => `- ${a.label} (${a.weight}): {{answers.${a.id}}}`).join("\n")}
Hard requirements (yes/no, p = probability met):
- Salesforce as system of record, bi-directional: {{answers.gate_sfdc_sor}} (p={{answers.gate_sfdc_sor.probability}})
- Deal-reg routing with expiry/denial: {{answers.gate_dealreg_lifecycle}} (p={{answers.gate_dealreg_lifecycle.probability}})
- Onboarding approval workflow: {{answers.gate_onboarding_approvals}} (p={{answers.gate_onboarding_approvals.probability}})

Evidence (search results and fetched pages):
{{input}}`;

const SYSTEM = `You evaluate PRM platforms for a channel team replacing Channelscaler. Partners are resellers, MSPs, distributors and technology partners; Salesforce is the CRM and must stay the system of record. Be concrete and terse. Cite source URLs from the evidence. Never invent a feature; say "not evidenced" when the evidence is silent.`;

const SCORECARD_PROMPT = `${SCORE_CONTEXT}

Write a scorecard for this vendor.
1. First line: vendor name and one-sentence positioning.
2. A markdown table with columns Area | Grade | Evidence (one short line with a source URL, or "not evidenced"). One row per area above, in the same order.
3. Top 3 strengths and top 3 risks for us, each one line.
Markdown, under 350 words.`;

const SHORTLIST_PROMPT = `${SCORE_CONTEXT}

This vendor passed the hard-requirements gate. Write a shortlist memo.
1. Why it could replace Channelscaler, in two sentences.
2. The five demo scenarios we must see live, each tied to an area graded partial or not_evidenced (e.g. distributor with 3 named users and offboarding; deal reg with provisional approval, expiry and auto-denial; bi-directional Salesforce sync with a custom field and a sync error).
3. Five RFP questions on migration: moving partner IDs, deal-reg statuses and history from Channelscaler without breaking reporting, coexistence during cutover, and total cost.
Markdown, under 300 words.`;

const DISQUALIFY_PROMPT = `${SCORE_CONTEXT}

This vendor did not clear at least one hard requirement (see the yes/no list above). Write a short disqualify note.
1. Which requirement is missing or unproven, citing the evidence or its absence.
2. Whether this is a real gap or only missing evidence, and the one question to ask the vendor that would settle it.
3. The situation where this vendor would still be worth a look (e.g. as an AI layer next to another PRM).
Markdown, under 200 words.`;

const BUILD_VS_BUY_PROMPT = `${SCORE_CONTEXT}

Build-vs-buy note for this vendor. "Build" means a custom partner portal on Salesforce Experience Cloud with custom objects and flows, plus an AI assistant (e.g. Agentforce or an LLM over program content), maintained by our own admins and developers.
1. For each area graded partial or not_evidenced, say whether we would close it by configuring this vendor, integrating a point tool, or building on Salesforce, in one line each.
2. Verdict: buy this vendor, buy and extend, or build instead. Give the reason in two sentences, weighing build and ongoing maintenance effort (distributor provisioning, deal-reg rules, MDF, migration of history) against license cost and vendor lock-in.
Markdown, under 250 words.`;

const OUTPUT_PROPERTIES = [
  { id: "prop-scorecard", name: "scorecard" },
  { id: "prop-verdict", name: "verdict" },
  { id: "prop-build-vs-buy", name: "build_vs_buy" },
];

/* ---------------------------------- graph --------------------------------- */

const h = (questionId, key) => `q:${questionId}:${key}`;

const SEARCHES = [
  {
    id: "portal",
    label: "Search: portal & onboarding",
    query: "{{input}} PRM partner portal onboarding enablement reviews",
  },
  {
    id: "sfdc",
    label: "Search: Salesforce & deal reg",
    query: "{{input}} PRM Salesforce integration deal registration approval",
  },
  {
    id: "mdf",
    label: "Search: MDF & distributors",
    query: "{{input}} PRM MDF management distributor two-tier channel",
  },
  {
    id: "ai",
    label: "Search: AI partner assistant",
    query: "{{input}} PRM AI assistant chatbot for partners",
  },
];

const nodes = [
  {
    id: "input",
    type: "input",
    position: { x: 0, y: 420 },
    deletable: false,
    data: { label: "PRM vendor name", sample: SAMPLE_INPUT },
  },
  ...SEARCHES.flatMap((s, i) => [
    {
      id: `search-${s.id}`,
      type: "web-search",
      position: { x: 340, y: i * 240 + 60 },
      data: { label: s.label, query: s.query, maxResults: 5 },
    },
    {
      id: `fetch-${s.id}`,
      type: "fetch",
      position: { x: 680, y: i * 240 + 60 },
      // The top two results; the rest stay as snippets from the search node.
      data: { label: `Fetch: ${s.id} top pages`, urls: "{{urls.1}}\n{{urls.2}}" },
    },
  ]),
  {
    id: "jev-grade",
    type: "jev",
    position: { x: 1040, y: 420 },
    data: {
      label: "Grade evaluation areas",
      questions: JEV_QUESTIONS,
      activation: "any",
    },
  },
  {
    id: "llm-scorecard",
    type: "llm",
    position: { x: 1560, y: 0 },
    data: {
      label: "Scorecard",
      model: MODEL,
      activation: "any",
      system: SYSTEM,
      prompt: SCORECARD_PROMPT,
    },
  },
  {
    id: "llm-shortlist",
    type: "llm",
    position: { x: 1560, y: 280 },
    data: {
      label: "Shortlist memo",
      model: MODEL,
      // AND: every hard requirement is yes.
      activation: "all",
      system: SYSTEM,
      prompt: SHORTLIST_PROMPT,
    },
  },
  {
    id: "llm-disqualify",
    type: "llm",
    position: { x: 1560, y: 560 },
    data: {
      label: "Disqualify note",
      model: MODEL,
      // OR: any hard requirement is no.
      activation: "any",
      system: SYSTEM,
      prompt: DISQUALIFY_PROMPT,
    },
  },
  {
    id: "llm-build-vs-buy",
    type: "llm",
    position: { x: 1560, y: 840 },
    data: {
      label: "Build vs buy",
      model: MODEL,
      activation: "any",
      system: SYSTEM,
      prompt: BUILD_VS_BUY_PROMPT,
    },
  },
  {
    id: "output",
    type: "output",
    position: { x: 2040, y: 420 },
    deletable: false,
    data: { label: "Output", activation: "any", properties: OUTPUT_PROPERTIES },
  },
];

/**
 * Each gate fires exactly one of yes/no. Shortlist takes all three yes (AND),
 * disqualify takes any no (OR), so every vendor lands in exactly one of them.
 */
const WIRES = [
  ...SEARCHES.flatMap((s) => [
    ["input", OUT_HANDLE, `search-${s.id}`, IN_HANDLE],
    [`search-${s.id}`, OUT_HANDLE, `fetch-${s.id}`, IN_HANDLE],
    // Snippets and fetched pages both reach the grader.
    [`search-${s.id}`, OUT_HANDLE, "jev-grade", IN_HANDLE],
    [`fetch-${s.id}`, OUT_HANDLE, "jev-grade", IN_HANDLE],
  ]),
  ["jev-grade", ANY_HANDLE, "llm-scorecard", IN_HANDLE],
  ...GATES.flatMap((g) => [
    ["jev-grade", h(g.id, "yes"), "llm-shortlist", IN_HANDLE],
    ["jev-grade", h(g.id, "no"), "llm-disqualify", IN_HANDLE],
  ]),
  ["jev-grade", ANY_HANDLE, "llm-build-vs-buy", IN_HANDLE],
  ["llm-scorecard", OUT_HANDLE, "output", "prop-scorecard"],
  ["llm-shortlist", OUT_HANDLE, "output", "prop-verdict"],
  ["llm-disqualify", OUT_HANDLE, "output", "prop-verdict"],
  ["llm-build-vs-buy", OUT_HANDLE, "output", "prop-build-vs-buy"],
];

const edges = WIRES.map(([source, sourceHandle, target, targetHandle]) => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`.replace(/[^\w-]/g, "_"),
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
if (AREAS.reduce((sum, a) => sum + a.weight, 0) !== 100) {
  throw new Error("area weights must sum to 100");
}
if (nodes.length > 25) throw new Error("more nodes than MAX_NODE_EXECUTIONS");

for (const [source, sourceHandle, target, targetHandle] of WIRES) {
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error(`wire references a missing node: ${source} -> ${target}`);
  }
  if (target === "output" && !OUTPUT_PROPERTIES.some((p) => p.id === targetHandle)) {
    throw new Error(`wire targets an unknown output property: ${targetHandle}`);
  }
  if (source === "jev-grade" && sourceHandle !== ANY_HANDLE) {
    const [, questionId, key] = sourceHandle.split(":");
    const q = JEV_QUESTIONS.find((x) => x.id === questionId);
    const ok = q?.type === "noul" ? ["yes", "no"].includes(key) : q?.levels?.[Number(key)];
    if (!ok) throw new Error(`handle ${sourceHandle} is not a real ${questionId} answer`);
  }
}

// Shortlist and disqualify must partition every combination of gate answers.
for (let mask = 0; mask < 1 << GATES.length; mask++) {
  const fired = new Set(GATES.map((g, i) => h(g.id, mask & (1 << i) ? "yes" : "no")));
  const fires = (target) => {
    const incoming = WIRES.filter(([, , t]) => t === target).map(([, sh]) => sh);
    const hits = incoming.filter((sh) => fired.has(sh)).length;
    const mode = nodes.find((n) => n.id === target).data.activation;
    return mode === "all" ? hits === incoming.length : hits > 0;
  };
  if (fires("llm-shortlist") === fires("llm-disqualify")) {
    throw new Error(`gate mask ${mask} fires both or neither verdict`);
  }
}

/* ---------------------------------- write --------------------------------- */

// Only seed when run directly, so the batch script can import AREAS.
if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });
  const metadata = { app: EXAMPLE_ID, workflowId, name: NAME };

  if (existingId) {
    await client.updateRoom(roomId, { metadata });
  } else {
    await client.createRoom(roomId, { defaultAccesses: ["room:write"], metadata });
  }

  console.log("workflowId:", workflowId);
  console.log("nodes:", nodes.length, "edges:", edges.length);

  // Clear everything first: the room's default output node has other
  // properties, and addNodes should not be relied on to overwrite it.
  await mutateFlow({ client, roomId, storageKey: FLOW_STORAGE_KEY }, (flow) => {
    if (flow.edges.length) flow.removeEdges(flow.edges.map((e) => e.id));
    if (flow.nodes.length) flow.removeNodes(flow.nodes.map((n) => n.id));
  });
  await mutateFlow({ client, roomId, storageKey: FLOW_STORAGE_KEY }, (flow) => {
    flow.addNodes(nodes);
    flow.addEdges(edges);
  });

  console.log(`open: http://localhost:3000/w/${workflowId}`);
}
