/**
 * Seeds the "Drayage qualifier" workflow into a Liveblocks room.
 *
 * The judgment layer for bigset's `fmcsa-discover-carriers` recipe. The recipe
 * finds intermodal-flagged carriers with SQL, a driver-count range, and a
 * safety band, and it has no way to express port proximity even though it
 * already selects phy_city / phy_zip. This graph takes one census candidate and
 * decides drayage fit from the evidence instead.
 *
 * Routing is disjoint by construction (see BRANCH DISJOINTNESS below), which
 * the earlier TAM qualifier was not.
 *
 * Usage: node .pi/scripts/seed-drayage-qualifier.mjs [workflowId]
 */
import { readFileSync } from "node:fs";
import { Liveblocks } from "@liveblocks/node";
import { mutateFlow } from "@liveblocks/react-flow/node";

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

const ROOM_PREFIX = "liveblocks:examples:nextjs-typesafe-workflow-builder";
const FLOW_STORAGE_KEY = "flow";
const IN_HANDLE = "in";
const OUT_HANDLE = "out";
const MODEL = "deepseek-v4.1-flash";

const workflowId = process.argv[2] ?? "alRCfXOHJO";
const roomId = `${ROOM_PREFIX}:${workflowId}`;

/* --------------------------------- content -------------------------------- */

// An unambiguous drayage profile: Corbin St in Elizabeth NJ is the heart of the
// Port Elizabeth / Port Newark drayage district. Intermodal cargo, 8 power
// units, middling SMS ranks, and one BASIC alert.
//
// A deliberately ambiguous record is worth trying too: DOT 1186285 SOUTHERN
// SHADE TREE CO INC is a tree company that nonetheless carries the intermodal
// cargo flag, and the operation question splits near-evenly on it.
const SAMPLE_INPUT = `USDOT 2450319 — PORT NEWARK CONTAINER SERVICES LLC
DBA: PNCS Drayage
Physical address: 1210 Corbin St, Elizabeth, NJ 07201
Classdef: AUTHORIZED FOR HIRE
Status: Active
Drivers: 9   Power units: 8   CDL holders: 9   Owned tractors: 7   Term tractors: 1
Cargo flags: crgo_intermodal, crgo_genfreight
Registered: 2014-04-02   Last MCS-150: 2025-01-28
Safety rating: S (satisfactory)
SMS measures, with PortPro population rank (share of the peer population scored
strictly above; higher is worse):
  Unsafe Driving       1.6   rank 58
  HOS Compliance       0.8   rank 47
  Vehicle Maintenance  1.0   rank 52
  Driver Fitness       0.1   rank 9
  Controlled Subst.    0.0   rank 1
BASIC alerts: unsafe_driv
Crashes 24mo: 1   Hazmat violations 24mo: 0`;

const OPERATION_OPTIONS = [
  {
    key: "drayage_intermodal",
    description:
      "Moves containers or intermodal freight short-haul for a port, rail ramp, or terminal. Intermodal cargo flag, a fleet small enough to run drayage, and no evidence of long-haul general freight as the main business.",
  },
  {
    key: "other_trucking",
    description:
      "A real for-hire carrier, but not a container drayage operator: long-haul truckload, LTL, flatbed, bulk, tanker, auto transport, or local cartage of non-container freight.",
  },
  {
    key: "passenger_or_household",
    description:
      "Passenger carrier (bus, limo, shuttle, school), household goods mover, or an otherwise non-freight operation that happens to appear in the same census.",
  },
  {
    key: "not_a_carrier",
    description:
      "Not an operating carrier at all: a broker, a shipper, or a company whose census record shows no fleet of its own.",
  },
];

/**
 * `classdef` is a compound designation field, so this replaces substring
 * matching on it. The recipe tests classdef.includes("AUTHORIZED FOR HIRE"),
 * .includes("PRIVATE PROPERTY") and .includes("PASSENGER") independently.
 */
const JEV_QUESTIONS = [
  {
    id: "operation",
    type: "choice",
    instructions:
      "What kind of operation is the carrier in `input`? Judge from the whole record together: classdef is a compound designation that can carry several values at once, so combine it with the cargo flags, the company name, the fleet composition (owned vs. term tractors), and the SMS profile. Do not rely on any single field.",
    options: OPERATION_OPTIONS,
  },
  {
    id: "port_oriented",
    type: "noul",
    instructions:
      "Does the physical address in `input` sit in a metro that hosts a major container port or intermodal rail ramp, where container drayage demand actually exists? Examples of in-scope metros: Newark / Elizabeth / Bayonne NJ, Los Angeles / Long Beach, Savannah, Houston, Charleston, Norfolk, Oakland, Seattle / Tacoma, Miami, Jacksonville, Memphis, Chicago, Dallas, Kansas City. A carrier in a landlocked or non-port metro is not port-oriented, even if it holds the intermodal cargo flag.",
    threshold: 0.7,
  },
  {
    id: "size_profile",
    type: "noul",
    instructions:
      "Does the fleet in `input` look like a small drayage operation that would buy drayage software, rather than a large carrier or a single owner-operator? Weigh power units against drivers: for drayage the truck count is the truer measure, because driver counts include owner-operators and leased drivers. Roughly 3 to 20 drivers with power units of the same order is a fit. A fleet of one truck, or one with substantially more power units than the ICP, is not.",
    threshold: 0.65,
  },
  {
    id: "risk_profile",
    type: "noul",
    instructions:
      "From the SMS measures, population ranks, alerts, and crash counts in `input`, is this a carrier worth calling? The target is a carrier that is operationally imperfect but not disqualified: middling population ranks (roughly the 40th to 80th percentile) and/or at least one active BASIC alert reads as a fit, because it needs help and will take a call. A carrier with clean ranks across the board has no reason to engage, and one in the top few percentiles with multiple alerts and crashes is a compliance risk rather than a prospect.",
    threshold: 0.6,
  },
];

const QUALIFIED_PROMPT = `Write a one-paragraph drayage qualification note for a rep about to work this carrier.

Carrier record:
{{input}}

Operation: {{answers.operation}} (probability {{answers.operation.probability}})
Port-oriented location: {{answers.port_oriented}} (probability {{answers.port_oriented.probability}})
Fleet size fit: {{answers.size_profile}} (probability {{answers.size_profile.probability}})
Risk profile fit: {{answers.risk_profile}} (probability {{answers.risk_profile.probability}})

Open with why it qualifies as a drayage target, name the single strongest piece of evidence, cite the port metro you matched, and suggest the opening angle. Plain text, under 90 words.`;

const ADJACENT_PROMPT = `Write a one-paragraph note for a carrier that is a real for-hire trucking operation near a port, but not clearly a container drayage operator.

Carrier record:
{{input}}

Operation: {{answers.operation}} (probability {{answers.operation.probability}})
Port-oriented location: {{answers.port_oriented}} (probability {{answers.port_oriented.probability}})
Fleet size fit: {{answers.size_profile}} (probability {{answers.size_profile.probability}})
Risk profile fit: {{answers.risk_profile}} (probability {{answers.risk_profile.probability}})

Say what it actually does, what would have to be true for it to become a drayage account, and the one question that would settle it. Plain text, under 90 words.`;

const REVIEW_PROMPT = `Write a short triage note for a carrier that did not clear the drayage screen. A human decides whether it belongs in the list.

Carrier record:
{{input}}

Operation: {{answers.operation}} (probability {{answers.operation.probability}})
Port-oriented location: {{answers.port_oriented}} (probability {{answers.port_oriented.probability}})
Fleet size fit: {{answers.size_profile}} (probability {{answers.size_profile.probability}})
Risk profile fit: {{answers.risk_profile}} (probability {{answers.risk_profile.probability}})

State what the record actually is, which checks it failed, and the one question a human should answer. Be specific about the failure rather than restating the record. Plain text, under 80 words.`;

const OUTPUT_PROPERTIES = [
  { id: "prop-qualified", name: "qualified" },
  { id: "prop-adjacent", name: "adjacent" },
  { id: "prop-review", name: "review" },
];

/* ---------------------------------- graph --------------------------------- */

const h = (questionId, key) => `q:${questionId}:${key}`;

const nodes = [
  {
    id: "input",
    type: "input",
    position: { x: 0, y: 300 },
    deletable: false,
    data: { label: "Carrier record", sample: SAMPLE_INPUT },
  },
  {
    id: "jev-drayage",
    type: "jev",
    position: { x: 380, y: 300 },
    data: {
      label: "Drayage qualification",
      questions: JEV_QUESTIONS,
      activation: "any",
    },
  },
  {
    id: "llm-qualified",
    type: "llm",
    position: { x: 840, y: 0 },
    data: {
      label: "Drayage qualification note",
      model: MODEL,
      // AND: container drayage AND port metro AND small fleet AND workable risk.
      activation: "all",
      system:
        "You qualify drayage carriers for an intermodal TMS. Be concrete and terse.",
      prompt: QUALIFIED_PROMPT,
    },
  },
  {
    id: "llm-adjacent",
    type: "llm",
    position: { x: 840, y: 320 },
    data: {
      label: "Adjacent trucking note",
      model: MODEL,
      activation: "all",
      system:
        "You qualify drayage carriers for an intermodal TMS. Be concrete and terse.",
      prompt: ADJACENT_PROMPT,
    },
  },
  {
    id: "llm-review",
    type: "llm",
    position: { x: 840, y: 640 },
    data: {
      label: "Review note",
      model: MODEL,
      // OR: any excluded operation, or any failed predicate.
      activation: "any",
      system: "You write short triage notes for a sales-ops reviewer.",
      prompt: REVIEW_PROMPT,
    },
  },
  {
    id: "output",
    type: "output",
    position: { x: 1300, y: 300 },
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
 * `operation` fires exactly one handle, and the three predicate questions each
 * fire exactly one of yes/no. So:
 *
 *   operation = drayage_intermodal
 *     qualified fires iff all three predicates are yes
 *     review    fires iff any predicate is no (its two operation handles are
 *               passenger_or_household / not_a_carrier, which cannot fire here)
 *     -> exactly one of {qualified, review}
 *
 *   operation = other_trucking
 *     adjacent  fires iff all three predicates are yes
 *     review    fires iff any predicate is no
 *     -> exactly one of {adjacent, review}
 *
 *   operation = passenger_or_household | not_a_carrier
 *     review always fires; qualified and adjacent cannot
 *
 * Every record lands in exactly one output property. The catch-all works
 * because its edge set excludes the two "good" operation handles, and the
 * predicate-no handles partition the predicates against the `all` gates.
 */
const WIRES = [
  ["input", OUT_HANDLE, "jev-drayage", IN_HANDLE],

  // Qualified: container drayage, in a port metro, right size, worth calling.
  ["jev-drayage", h("operation", "drayage_intermodal"), "llm-qualified", IN_HANDLE],
  ["jev-drayage", h("port_oriented", "yes"), "llm-qualified", IN_HANDLE],
  ["jev-drayage", h("size_profile", "yes"), "llm-qualified", IN_HANDLE],
  ["jev-drayage", h("risk_profile", "yes"), "llm-qualified", IN_HANDLE],

  // Adjacent: a real for-hire carrier, in a port metro, right size, worth calling.
  ["jev-drayage", h("operation", "other_trucking"), "llm-adjacent", IN_HANDLE],
  ["jev-drayage", h("port_oriented", "yes"), "llm-adjacent", IN_HANDLE],
  ["jev-drayage", h("size_profile", "yes"), "llm-adjacent", IN_HANDLE],
  ["jev-drayage", h("risk_profile", "yes"), "llm-adjacent", IN_HANDLE],

  // Review: excluded operation, or any failed predicate.
  ["jev-drayage", h("operation", "passenger_or_household"), "llm-review", IN_HANDLE],
  ["jev-drayage", h("operation", "not_a_carrier"), "llm-review", IN_HANDLE],
  ["jev-drayage", h("port_oriented", "no"), "llm-review", IN_HANDLE],
  ["jev-drayage", h("size_profile", "no"), "llm-review", IN_HANDLE],
  ["jev-drayage", h("risk_profile", "no"), "llm-review", IN_HANDLE],

  ["llm-qualified", OUT_HANDLE, "output", "prop-qualified"],
  ["llm-adjacent", OUT_HANDLE, "output", "prop-adjacent"],
  ["llm-review", OUT_HANDLE, "output", "prop-review"],
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
  const property = OUTPUT_PROPERTIES.find((p) => p.id === targetHandle);
  if (target === "output" && !property) {
    throw new Error(`wire targets an unknown output property: ${targetHandle}`);
  }
}

// Every source handle must exist on the question it claims to come from.
const handlesFor = (questionId) => {
  const q = JEV_QUESTIONS.find((x) => x.id === questionId);
  if (!q) throw new Error(`unknown question ${questionId}`);
  if (q.type === "noul") return ["yes", "no"];
  return (q.options ?? q.levels).map((c) => c.key);
};
for (const [source, sourceHandle] of WIRES) {
  if (source !== "jev-drayage") continue;
  const [, questionId, key] = sourceHandle.split(":");
  if (!handlesFor(questionId).includes(key)) {
    throw new Error(`handle ${sourceHandle} is not a real ${questionId} answer`);
  }
}

// No node may be gated on two handles of the same choice question: `all`
// requires every incoming edge to fire, and a choice fires only one handle.
for (const node of nodes) {
  const incoming = WIRES.filter(([, , target]) => target === node.id);
  if (incoming.length && (node.data.activation ?? "any") === "all") {
    const choiceQuestions = incoming
      .map(([, sh]) => sh.split(":")[1])
      .filter((qid) => JEV_QUESTIONS.find((q) => q.id === qid)?.type === "choice");
    if (new Set(choiceQuestions).size !== choiceQuestions.length) {
      throw new Error(
        `${node.id} is an AND gate fed by two handles of the same choice question; it would never run`,
      );
    }
  }
}

// The two "good" operation handles must not appear in the catch-all's edge set.
const reviewHandles = WIRES.filter(([, , t]) => t === "llm-review").map(([, sh]) => sh);
for (const good of ["drayage_intermodal", "other_trucking"]) {
  if (reviewHandles.includes(h("operation", good))) {
    throw new Error(`catch-all includes ${good}; branches would overlap`);
  }
}

/* ---------------------------------- write --------------------------------- */

const client = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });

console.log("room:", roomId);
console.log("nodes:", nodes.length, "edges:", edges.length);

const stale = { nodes: [], edges: [] };

await mutateFlow({ client, roomId, storageKey: FLOW_STORAGE_KEY }, (flow) => {
  stale.nodes = flow.nodes.map((n) => n.id).filter((id) => !nodeIds.has(id));
  stale.edges = flow.edges.map((e) => e.id).filter((id) => !edgeIds.has(id));

  if (stale.edges.length) flow.removeEdges(stale.edges);
  if (stale.nodes.length) flow.removeNodes(stale.nodes);

  flow.addNodes(nodes);
  flow.addEdges(edges);
});

console.log("removed stale nodes:", stale.nodes);
console.log("removed stale edges:", stale.edges.length);
console.log("done");
