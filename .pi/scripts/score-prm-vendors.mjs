/**
 * Runs the PRM vendor evaluator once per vendor and ranks them.
 *
 * The composite uses the expected level per area (sum of level × probability,
 * 0..2) from the Jev trace, not the rounded grade, times the area weight from
 * seed-prm-evaluator.mjs. 100 = strong everywhere. Channelscaler runs too, as
 * the baseline to beat.
 *
 * Usage: node .pi/scripts/score-prm-vendors.mjs [workflowId] [vendor ...]
 * Needs `npm run dev` on localhost:3000.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { AREAS } from "./seed-prm-evaluator.mjs";

const workflowId = process.argv[2] ?? "ejFja9LgpU";
const VENDORS = process.argv.length > 3
  ? process.argv.slice(3)
  : ["Channelscaler", "Impartner", "EULER", "Salesforce Experience Cloud", "ZINFI"];
const OUT_DIR = new URL("../prm/", import.meta.url);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

mkdirSync(new URL("runs/", OUT_DIR), { recursive: true });

async function runOnce(vendor) {
  const res = await fetch(
    `http://localhost:3000/api/workflows/${workflowId}/runs?wait=true`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: vendor, trigger: "api" }),
    },
  );
  // A run with a failed node answers 500 with the trace as the body.
  const trace = await res.json().catch(() => null);
  if (!trace?.nodes) throw new Error(`${vendor}: HTTP ${res.status}`);
  return trace;
}

// Retries once when a node errored (TinyFish and Zen fail transiently).
async function run(vendor) {
  let trace = await runOnce(vendor);
  if (trace.status === "error") {
    console.log(`error (${trace.error ?? "node failed"}), retrying`);
    trace = await runOnce(vendor);
  }
  writeFileSync(new URL(`runs/${slug(vendor)}.json`, OUT_DIR), JSON.stringify(trace, null, 2));
  return trace;
}

const expected = (answer) =>
  Object.entries(answer?.probabilities ?? {}).reduce((sum, [lvl, p]) => sum + Number(lvl) * p, 0);

const rows = [];

for (const vendor of VENDORS) {
  process.stdout.write(`${vendor} … `);
  let trace;
  try {
    trace = await run(vendor);
  } catch (error) {
    console.log(`skipped: ${error.message}`);
    continue;
  }

  const jev = trace.nodes?.find((n) => n.nodeId === "jev-grade");
  const answers = jev?.answers ?? {};
  const problems = (trace.nodes ?? [])
    .filter((n) => n.status === "error" || n.mock)
    .map((n) => `${n.nodeId}: ${n.error ?? "mock output"}`);
  const levels = Object.fromEntries(AREAS.map((a) => [a.id, expected(answers[a.id])]));
  const composite = AREAS.reduce((sum, a) => sum + (a.weight * levels[a.id]) / 2, 0);
  // All three hard requirements must hold; report the weakest one.
  const gates = ["gate_sfdc_sor", "gate_dealreg_lifecycle", "gate_onboarding_approvals"]
    .map((id) => answers[id]?.noul)
    .filter((p) => p != null);
  const gate = gates.length ? Math.min(...gates) : null;
  const passed = gates.length === 3 && gates.every((p) => p >= 0.6);

  rows.push({ vendor, composite, gate, passed, levels, output: trace.output ?? {}, problems, status: trace.status });
  console.log(`${trace.status} composite=${composite.toFixed(1)} gates=${gates.join("/")} ${passed ? "SHORTLIST" : "disqualify"}`);
}

rows.sort((a, b) => b.composite - a.composite);

/* --------------------------------- report --------------------------------- */

const fmt = (x) => x.toFixed(2);
const header = `| Vendor | Composite /100 | Weakest gate p | Verdict | ${AREAS.map((a) => `${a.label} (${a.weight})`).join(" | ")} |`;
const divider = `|${" --- |".repeat(AREAS.length + 4)}`;
const table = rows
  .map(
    (r) =>
      `| ${r.vendor} | ${r.composite.toFixed(1)} | ${r.gate ?? "–"} | ${r.passed ? "shortlist" : "disqualify"} | ${AREAS.map((a) => fmt(r.levels[a.id])).join(" | ")} |`,
  )
  .join("\n");

const sections = rows
  .map((r) => {
    const out = (key) => (r.output[key] ?? []).join("\n\n") || "_(not produced)_";
    return [
      `## ${r.vendor} (composite ${r.composite.toFixed(1)}, gate p=${r.gate ?? "–"})`,
      r.problems.length ? `> Run problems: ${r.problems.join("; ")}` : "",
      "### Scorecard",
      out("scorecard"),
      "### Verdict",
      out("verdict"),
      "### Build vs buy",
      out("build_vs_buy"),
    ]
      .filter(Boolean)
      .join("\n\n");
  })
  .join("\n\n---\n\n");

const report = `# PRM vendor comparison (Channelscaler replacement)

Generated ${new Date().toISOString().slice(0, 10)} from workflow ${workflowId}. Area values are expected grade 0..2 (0 not evidenced, 1 partial, 2 strong) from public web evidence only. Composite = Σ weight × level / 2. Weakest gate p = the lowest probability among the three hard requirements (Salesforce SoR sync, deal-reg routing with expiry/denial, onboarding approvals); shortlist needs all three ≥ 0.6. Low scores often mean the public web is thin, not that the feature is missing: treat them as demo questions.

${header}
${divider}
${table}

${sections}
`;

writeFileSync(new URL("report.md", OUT_DIR), report);
writeFileSync(
  new URL("results.json", OUT_DIR),
  JSON.stringify(rows.map(({ output, ...r }) => r), null, 2),
);
console.log(`\nwrote .pi/prm/report.md`);
