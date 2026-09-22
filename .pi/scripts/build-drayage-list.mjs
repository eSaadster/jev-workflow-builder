/**
 * Builds a real drayage fleet list from the FMCSA census and runs every record
 * through the Jev drayage-qualifier workflow.
 *
 * Two verdicts per carrier:
 *   recipe  - the deterministic filter chain in bigset's fmcsa-discover-carriers
 *             (intermodal + driver band + safety band, with the hardcoded alert
 *             override). This is what decides whether a carrier is "in the list".
 *   jev     - the workflow's tier: qualified / adjacent / review.
 *
 * The census filters are applied first, then the safety band is evaluated
 * SEPARATELY rather than used to pre-filter, so carriers the band would have
 * dropped still reach Jev and the disagreements stay visible.
 *
 * Usage:
 *   node .pi/scripts/build-drayage-list.mjs [--limit=30] [--states=NJ,NY] [--force]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_BASICS, MEASURE_MIN_INSPECTIONS, RANKED_BASICS,
  buildDistribution, censusCandidates, fetchSmsByDots, fetchSupplementaryCounts,
  rankOfMeasure, ratingLabel, recipeVerdict, renderRecord, summarizeExtended,
} from "./lib/fmcsa.mjs";

/* ---------------------------------- cli ----------------------------------- */

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const LIMIT = Number(flag("limit", 30));
const STATES = flag("states", "NJ,NY").split(",").map((s) => s.trim()).filter(Boolean);
const FORCE = has("force");

const WORKFLOW_API = flag("api", "http://localhost:3001/api/workflows/alRCfXOHJO/runs?wait=true");
const OUT_DIR = new URL("../drayage/", import.meta.url).pathname;
const RUN_CACHE = join(OUT_DIR, "runs");
const DIST_CACHE = join(OUT_DIR, "distribution.json");
mkdirSync(RUN_CACHE, { recursive: true });

/* --------------------------------- inputs --------------------------------- */

// Mirrors the recipe's inputSchema defaults for a drayage sweep.
const RECIPE_INPUTS = {
  countries: ["US"],
  states: STATES,
  driverMin: 3,
  driverMax: 20,
  requireIntermodal: true,
  requireAuthorizedForHire: true,
  excludePassenger: true,
  maxCandidates: LIMIT,
};

const log = (m) => console.log(m);

/* ------------------------------- 1. ranks --------------------------------- */

log(`== building the BASIC population distribution (min ${MEASURE_MIN_INSPECTIONS} inspections) ==`);
const t0 = Date.now();
const dist = await buildDistribution(DIST_CACHE, { basics: ALL_BASICS, minInspections: MEASURE_MIN_INSPECTIONS, log });
const usable = Object.values(dist.sources).reduce((n, s) => n + s.usable, 0);
log(`   population: ${usable} carriers across ${Object.keys(dist.sources).length} files in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const b of RANKED_BASICS) {
  log(`   ${b.padEnd(14)} p50 cut=${dist.cut_points[b].points[50]}  p74 cut=${dist.cut_points[b].points[74]}  n=${dist.cut_points[b].total}`);
}

/* ----------------------------- 2. candidates ------------------------------ */

log(`\n== pulling census candidates (${STATES.join("+")}, intermodal, active, ${RECIPE_INPUTS.driverMin}-${RECIPE_INPUTS.driverMax} drivers) ==`);
const { candidates, scanned } = await censusCandidates(RECIPE_INPUTS, { log });
log(`   scanned ${scanned} census rows -> ${candidates.length} passed the census filters`);
if (!candidates.length) throw new Error("no candidates; loosen the census filters");

/* ------------------------- 3. SMS + supplementary ------------------------- */

log(`\n== fetching SMS measures and crash/hazmat counts ==`);
const dots = candidates.map((c) => c.dot_number);
const smsMap = await fetchSmsByDots(dots);
const supMap = await fetchSupplementaryCounts(dots);
const withSms = dots.filter((d) => smsMap.has(d)).length;
log(`   ${withSms}/${dots.length} have an SMS property row; ${dots.length - withSms} have no inspection history`);

/* ---------------------------- 4. run the list ---------------------------- */

log(`\n== running ${candidates.length} records through the workflow ==`);
const results = [];
let done = 0;

for (const c of candidates) {
  done += 1;
  const sms = smsMap.get(c.dot_number) ?? null;
  const supplementary = supMap.get(c.dot_number) ?? { crash_24mo: 0, hazmat_viol_24mo: 0 };
  const { text, summary } = renderRecord(c, sms, supplementary, dist);
  const runPath = join(RUN_CACHE, `${c.dot_number}.json`);

  let trace = null;
  if (!FORCE && existsSync(runPath)) {
    trace = JSON.parse(readFileSync(runPath, "utf8"));
  } else {
    const res = await fetch(WORKFLOW_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, trigger: "api" }),
    });
    trace = await res.json();
    writeFileSync(runPath, JSON.stringify(trace, null, 2));
  }

  const jevNode = trace.nodes?.find((n) => n.nodeType === "jev");
  const tier = Object.entries(trace.output ?? {}).find(([, v]) => v?.length)?.[0] ?? "none";
  const ans = jevNode?.answers ?? {};
  const p = (q) => (ans[q]?.type === "choice"
    ? { value: ans[q].choice, probability: ans[q].probabilities[ans[q].choice] }
    : ans[q]
      ? { value: ans[q].noul >= ans[q].threshold ? "yes" : "no", probability: ans[q].noul }
      : null);

  const verdict = recipeVerdict(summary ?? null);
  results.push({
    dot_number: c.dot_number,
    legal_name: c.legal_name,
    city: c.phy_city,
    state: c.phy_state,
    zip: c.phy_zip,
    classdef: c.classdef,
    drivers: c.driver_total || null,
    power_units: c.nbr_power_unit || null,
    safety_rating: c.safety_rating || null,
    max_pct: summary?.maxPct ?? null,
    top_basic: summary?.topBasic ?? null,
    alerts: summary?.alerts ?? [],
    insp_total: summary?.inspTotal ?? null,
    rating: summary ? (summary.insufficient ? "No score" : ratingLabel(summary.maxPct)) : "No score",
    crash_24mo: supplementary.crash_24mo,
    hazmat_viol_24mo: supplementary.hazmat_viol_24mo,
    recipe_kept: verdict.kept,
    recipe_reason: verdict.reason,
    jev_tier: tier,
    jev_operation: p("operation")?.value ?? null,
    jev_operation_p: p("operation")?.probability ?? null,
    jev_port_oriented: p("port_oriented")?.value ?? null,
    jev_port_oriented_p: p("port_oriented")?.probability ?? null,
    jev_size_profile: p("size_profile")?.value ?? null,
    jev_size_profile_p: p("size_profile")?.probability ?? null,
    jev_risk_profile: p("risk_profile")?.value ?? null,
    jev_risk_profile_p: p("risk_profile")?.probability ?? null,
    jev_mock: jevNode?.mock ?? null,
    jev_model: jevNode?.model ?? null,
    jev_ms: jevNode?.durationMs ?? null,
    run_status: trace.status,
    run_id: trace.runId,
    note: (trace.output?.[tier] ?? [])[0] ?? null,
    input_text: text,
  });

  const mark = tier === "qualified" ? "Q" : tier === "adjacent" ? "A" : "R";
  log(
    `  [${String(done).padStart(2)}/${candidates.length}] ${mark} ${c.dot_number.padEnd(9)} ` +
    `${c.legal_name.slice(0, 30).padEnd(31)} ${`${c.phy_city},${c.phy_state}`.slice(0, 18).padEnd(19)} ` +
    `rank=${String(summary?.maxPct ?? "-").padStart(3)} recipe=${verdict.kept ? "kept" : "drop"} jev=${tier}`,
  );
}

/* -------------------------------- 5. output ------------------------------- */

const csvCols = Object.keys(results[0]).filter((k) => k !== "input_text" && k !== "note");
const csv = [
  csvCols.join(","),
  ...results.map((r) => csvCols.map((k) => {
    const v = r[k];
    const s = Array.isArray(v) ? v.join("|") : v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")),
].join("\n");

writeFileSync(join(OUT_DIR, "drayage-list.csv"), csv);
writeFileSync(join(OUT_DIR, "drayage-list.json"), JSON.stringify(results, null, 2));

const crosstab = () => {
  const cells = {};
  for (const r of results) {
    const key = `${r.recipe_kept ? "recipe:kept" : "recipe:drop"} / jev:${r.jev_tier}`;
    cells[key] = (cells[key] ?? 0) + 1;
  }
  return cells;
};

const md = [
  "# Drayage fleet list — recipe verdict vs Jev tier",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Census filter: ${STATES.join("+")}, crgo_intermodal='X', status active, ${RECIPE_INPUTS.driverMin}-${RECIPE_INPUTS.driverMax} drivers, authorized-for-hire, non-passenger, non-private.`,
  `Scanned ${scanned} census rows; ${candidates.length} passed. Safety band [50,74] with the recipe's alert override was NOT used to pre-filter, so band-dropped carriers still reached Jev.`,
  `Rank population: ${usable} carriers with >= ${MEASURE_MIN_INSPECTIONS} inspections (PortPro population rank, not an FMCSA percentile).`,
  "",
  "## Cross-tab",
  "",
  "| " + Object.keys(crosstab()).join(" | ") + " |",
  "|" + Object.keys(crosstab()).map(() => "---").join("|") + "|",
  "| " + Object.values(crosstab()).join(" | ") + " |",
  "",
  "## Carriers",
  "",
  "| DOT | Name | City | Drv | PU | maxRank | alerts | recipe | Jev tier | op (p) | port (p) | size (p) | risk (p) |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.dot_number} | ${r.legal_name} | ${r.city}, ${r.state} | ${r.drivers ?? "–"} | ${r.power_units ?? "–"} | ${r.max_pct ?? "–"} | ${r.alerts.join(",") || "–"} | ${r.recipe_kept ? "keep" : "drop"} | **${r.jev_tier}** | ${r.jev_operation} (${r.jev_operation_p?.toFixed(2)}) | ${r.jev_port_oriented} (${r.jev_port_oriented_p?.toFixed(2)}) | ${r.jev_size_profile} (${r.jev_size_profile_p?.toFixed(2)}) | ${r.jev_risk_profile} (${r.jev_risk_profile_p?.toFixed(2)}) |`),
  "",
].join("\n");
writeFileSync(join(OUT_DIR, "drayage-list.md"), md);

log(`\n== cross-tab ==`);
for (const [k, v] of Object.entries(crosstab())) log(`   ${k.padEnd(26)} ${v}`);
log(`\nwrote ${OUT_DIR}drayage-list.{csv,json,md}`);
