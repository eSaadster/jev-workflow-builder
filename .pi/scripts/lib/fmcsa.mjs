/**
 * Faithful port of bigset's portpro/FMCSA recipe modules to plain JS, so the
 * drayage list can be built outside the TypeScript repo.
 *
 * Mirrors, and cites, these files:
 *   backend/src/recipes/portpro/fmcsa/socrata.ts       -> socrata()
 *   backend/src/recipes/portpro/fmcsa/distribution.ts  -> buildDistribution(), rankOfMeasure(), summarizeMeasureRow()
 *   backend/src/recipes/portpro/fmcsa/scoring.ts       -> summarizeExtended(), passesSafetyBand(), ratingLabel()
 *   backend/src/recipes/portpro/fmcsa/discover-carriers.ts -> census query, normalizeCensusRow(), passesCensusFilters()
 *
 * One deliberate deviation, documented at buildDistribution(): rows whose
 * insp_total is '0' or '' are excluded server-side instead of client-side.
 * Those rows are always skipped by the min-inspections rule, so the resulting
 * histogram is identical while the transfer drops from ~2.1M rows to ~577k.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/* ------------------------------- constants -------------------------------- */

export const SOCRATA_DOMAIN = "data.transportation.gov";
const PACE_MS = 250;
const MAX_RETRIES = 5;

const CENSUS_DATASET_ID = "az4n-8mr2";
const EMAIL_BACKFILL_DATASET_ID = "kjg3-diqy";
const CRASH_DATASET_ID = "4wxs-vbns";
const VIOLATION_DATASET_ID = "8mt8-2mdr";

// distribution.ts
export const PROPERTY_DATASET_IDS = ["h9zy-gjn8", "4y6x-dmck"];
export const MEASURE_MIN_INSPECTIONS = 5;
const RESOLUTION = 100;
const MAX_MEASURE = 2000;
const BUCKETS = MAX_MEASURE * RESOLUTION + 1;
const DISTRIBUTION_PAGE_SIZE = 50_000;

// scoring.ts
export const RANKED_BASICS = ["unsafe_driv", "hos_driv", "veh_maint", "driv_fit"];
export const FLAG_BASICS = ["contr_subst"];
export const ALL_BASICS = [...RANKED_BASICS, ...FLAG_BASICS];
export const SCORE_TYPE = "portpro_population_rank";
export const BANDS = { goodMax: 49, midMax: 74 };
export const HAZMAT_BASIC_DESC = "Hazardous Materials Compliance";

// discover-carriers.ts
const CENSUS_PAGE_SIZE = 1000;
const INCLUDE_BASIC_ALERT = true; // hardcoded const in the recipe, not an input

const CENSUS_SELECT = [
  "dot_number", "legal_name", "dba_name", "total_drivers", "power_units",
  "phy_city", "phy_state", "phy_zip", "phone", "email_address", "classdef",
  "status_code", "safety_rating", "crgo_intermodal", "crgo_passengers",
].join(",");

/* -------------------------------- socrata --------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function quoteList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(",");
}

let lastRequestAt = 0;

/** Paced, retrying Socrata GET. Mirrors createSocrataClient(). */
export async function socrata(datasetId, params) {
  const url = new URL(`https://${SOCRATA_DOMAIN}/resource/${datasetId}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const token = process.env.SOCRATA_APP_TOKEN;
  const headers = { Accept: "application/json" };
  if (token) headers["X-App-Token"] = token;

  for (let attempt = 0; ; attempt++) {
    const wait = PACE_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw new Error(`Socrata ${datasetId} network: ${err.message}`);
      await sleep(2000 * 2 ** attempt);
      continue;
    }

    if (res.ok) return await res.json();

    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`Socrata ${datasetId} ${res.status}: ${body.slice(0, 300)}`);
    }
    await sleep(2000 * 2 ** attempt);
  }
}

/* ------------------------------ distribution ------------------------------ */

const bucketOf = (v) => Math.min(BUCKETS - 1, Math.max(0, Math.round(v * RESOLUTION)));

/**
 * Same output as buildDistribution(): 101 cut points per BASIC from the property
 * population with insp_total >= minInspections. The rank a carrier gets is the
 * share of the peer population it scores strictly above, not an FMCSA
 * percentile (FMCSA only publishes those for passenger carriers).
 */
export async function buildDistribution(cachePath, { basics = ALL_BASICS, minInspections = MEASURE_MIN_INSPECTIONS, log = () => {} } = {}) {
  if (cachePath && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (cached.min_inspections === minInspections && basics.every((b) => cached.cut_points?.[b])) {
      log(`distribution: cache hit (${cachePath})`);
      return cached;
    }
  }

  const sources = {};
  const hist = new Map(basics.map((b) => [b, new Int32Array(BUCKETS)]));
  const counts = new Map(basics.map((b) => [b, 0]));
  const select = ["insp_total", ...basics.map((b) => `${b}_measure`)].join(",");

  for (const datasetId of PROPERTY_DATASET_IDS) {
    let rows = 0;
    let used = 0;
    for (let offset = 0; ; offset += DISTRIBUTION_PAGE_SIZE) {
      const page = await socrata(datasetId, {
        $select: select,
        // Deviation from the recipe: these rows are always skipped by the
        // min-inspections rule, so excluding them changes nothing but the cost.
        $where: "insp_total!='0' AND insp_total!=''",
        $order: "dot_number",
        $limit: String(DISTRIBUTION_PAGE_SIZE),
        $offset: String(offset),
      });
      if (!page.length) break;
      rows += page.length;

      for (const row of page) {
        if (Number(row.insp_total ?? 0) < minInspections) continue;
        used += 1;
        for (const basic of basics) {
          const value = Number(row[`${basic}_measure`]);
          if (!Number.isFinite(value)) continue;
          hist.get(basic)[bucketOf(value)] += 1;
          counts.set(basic, counts.get(basic) + 1);
        }
      }
      log(`  ${datasetId}: +${page.length} rows (${used} usable so far)`);
      if (page.length < DISTRIBUTION_PAGE_SIZE) break;
    }
    sources[datasetId] = { fetched: rows, usable: used };
  }

  const cutPoints = {};
  for (const basic of basics) {
    const h = hist.get(basic);
    const total = counts.get(basic);
    const points = new Array(101).fill(0);
    let cumulative = 0;
    let next = 0;
    for (let i = 0; i < BUCKETS && next <= 100; i++) {
      cumulative += h[i];
      while (next <= 100 && cumulative >= (total * next) / 100) {
        points[next] = i / RESOLUTION;
        next++;
      }
    }
    while (next <= 100) points[next++] = MAX_MEASURE;
    cutPoints[basic] = { total, points };
  }

  const dist = {
    built_at: new Date().toISOString(),
    datasets: PROPERTY_DATASET_IDS,
    min_inspections: minInspections,
    basics,
    sources,
    cut_points: cutPoints,
  };
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(dist));
  }
  return dist;
}

/** Percentage of the peer population this carrier scores strictly above. */
export function rankOfMeasure(dist, basic, measure) {
  const points = dist.cut_points?.[basic]?.points;
  if (!points || !Number.isFinite(measure)) return null;
  let rank = 0;
  for (let p = 0; p <= 100; p++) {
    if (points[p] < measure) rank = p;
    else break;
  }
  return rank;
}

/** Mirrors summarizeMeasureRow() for RANKED_BASICS. */
export function summarizeMeasureRow(dist, row, basics, minInspections) {
  if (Number(row.insp_total ?? 0) < minInspections) {
    return { maxPct: null, topBasic: null, alerts: [], insufficient: true };
  }
  let maxPct = null;
  let topBasic = null;
  for (const basic of basics) {
    const value = Number(row[`${basic}_measure`]);
    if (!Number.isFinite(value)) continue;
    const rank = rankOfMeasure(dist, basic, value);
    if (rank != null && (maxPct == null || rank > maxPct)) {
      maxPct = rank;
      topBasic = basic;
    }
  }
  const alerts = basics.filter((b) => String(row[`${b}_ac`] ?? "").toUpperCase() === "Y");
  return { maxPct, topBasic, alerts, insufficient: maxPct == null && alerts.length === 0 };
}

/** Mirrors summarizeExtended(). */
export function summarizeExtended(dist, sms, minInspections) {
  const base = summarizeMeasureRow(dist, sms, RANKED_BASICS, minInspections);
  const ranks = {};
  for (const basic of ALL_BASICS) {
    const value = Number(sms?.[`${basic}_measure`]);
    ranks[basic] = Number.isFinite(value) ? rankOfMeasure(dist, basic, value) : null;
  }
  const contrFlag =
    String(sms?.contr_subst_ac ?? "").toUpperCase() === "Y" ||
    (ranks.contr_subst != null && ranks.contr_subst >= 96)
      ? "Y"
      : "";
  return {
    ...base,
    ranks,
    contrFlag,
    // Base alerts come from RANKED_BASICS; summarizeExtended widens to ALL_BASICS.
    alerts: ALL_BASICS.filter((b) => String(sms?.[`${b}_ac`] ?? "").toUpperCase() === "Y"),
    inspTotal: Number(sms?.insp_total ?? 0),
  };
}

export function passesSafetyBand(summary, minPct, maxPct, includeAlert) {
  if (includeAlert && summary.alerts.length > 0) return true;
  if (summary.maxPct == null) return false;
  return summary.maxPct >= minPct && summary.maxPct <= maxPct;
}

export function ratingLabel(maxPct, bands = BANDS) {
  if (maxPct == null) return "No score";
  if (maxPct <= bands.goodMax) return "Good";
  if (maxPct <= bands.midMax) return "Mid";
  return "Bad";
}

/* --------------------------------- census --------------------------------- */

export function normalizeCensusRow(row) {
  const classdef = String(row.classdef ?? "");
  return {
    dot_number: String(row.dot_number ?? ""),
    legal_name: String(row.legal_name ?? ""),
    dba_name: String(row.dba_name ?? ""),
    driver_total: String(row.total_drivers ?? ""),
    nbr_power_unit: String(row.power_units ?? ""),
    phy_city: String(row.phy_city ?? ""),
    phy_state: String(row.phy_state ?? ""),
    phy_zip: String(row.phy_zip ?? ""),
    telephone: String(row.phone ?? ""),
    email_address: String(row.email_address ?? ""),
    safety_rating: String(row.safety_rating ?? ""),
    intermodal: row.crgo_intermodal === "X",
    passenger: row.crgo_passengers === "X" || classdef.includes("PASSENGER"),
    authorized_for_hire: classdef.includes("AUTHORIZED FOR HIRE"),
    private_only: classdef.includes("PRIVATE PROPERTY") && !classdef.includes("AUTHORIZED FOR HIRE"),
    active: row.status_code === "A",
    classdef,
  };
}

/** Mirrors passesCensusFilters(). */
export function passesCensusFilters(c, inputs) {
  const drivers = parseInt(c.driver_total, 10);
  if (Number.isFinite(drivers)) {
    if (drivers < inputs.driverMin || drivers > inputs.driverMax) return false;
  } else if (inputs.driverMin > 0) {
    // A blank driver count is unknown, not zero: drop it only under a floor.
    return false;
  }
  if (inputs.states.length && !inputs.states.includes(c.phy_state)) return false;
  if (!c.active) return false;
  if (inputs.excludePassenger && c.passenger) return false;
  if (inputs.requireAuthorizedForHire && !c.authorized_for_hire) return false;
  if (c.private_only) return false;
  if (inputs.requireIntermodal && c.intermodal !== true) return false;
  return true;
}

/** Pages the census with the recipe's server-side clauses. */
export async function censusCandidates(inputs, { log = () => {} } = {}) {
  const clauses = [];
  if (inputs.states.length) clauses.push(`phy_state in(${quoteList(inputs.states)})`);
  if (inputs.countries.length) clauses.push(`phy_country in(${quoteList(inputs.countries)})`);
  if (inputs.requireIntermodal) clauses.push(`crgo_intermodal='X'`);
  clauses.push(`status_code='A'`);

  const out = [];
  let scanned = 0;
  for (let offset = 0; ; offset += CENSUS_PAGE_SIZE) {
    const rows = await socrata(CENSUS_DATASET_ID, {
      $select: CENSUS_SELECT,
      $where: clauses.join(" AND "),
      $order: "dot_number",
      $limit: String(CENSUS_PAGE_SIZE),
      $offset: String(offset),
    });
    if (!rows.length) break;
    scanned += rows.length;
    for (const row of rows) {
      const c = normalizeCensusRow(row);
      if (passesCensusFilters(c, inputs)) out.push(c);
    }
    log(`  census offset ${offset}: scanned ${scanned}, kept ${out.length}`);
    if (rows.length < CENSUS_PAGE_SIZE) break;
    if (inputs.maxCandidates && out.length >= inputs.maxCandidates) break;
  }

  if (inputs.maxCandidates) out.length = Math.min(out.length, inputs.maxCandidates);
  return { candidates: out, scanned };
}

/* ------------------------------ SMS + extras ------------------------------ */

/** Property SMS rows for a batch of DOTs. DOTs do not overlap between the two files. */
export async function fetchSmsByDots(dots) {
  if (!dots.length) return new Map();
  const select = [
    "dot_number", "insp_total",
    ...ALL_BASICS.flatMap((b) => [`${b}_measure`, `${b}_ac`]),
  ].join(",");
  const where = `dot_number in(${quoteList(dots)})`;
  const map = new Map();
  for (const datasetId of PROPERTY_DATASET_IDS) {
    const rows = await socrata(datasetId, { $select: select, $where: where, $limit: String(dots.length) });
    for (const row of rows) {
      const dot = String(row.dot_number);
      if (!map.has(dot)) map.set(dot, { ...row, _dataset: datasetId });
    }
  }
  return map;
}

export async function fetchSupplementaryCounts(dots) {
  const out = new Map(dots.map((d) => [d, { crash_24mo: 0, hazmat_viol_24mo: 0 }]));
  if (!dots.length) return out;
  const whereIn = `dot_number in(${quoteList(dots)})`;

  for (const row of await socrata(CRASH_DATASET_ID, {
    $select: "dot_number, count(*) as crash_24mo",
    $where: whereIn,
    $group: "dot_number",
  })) {
    const slot = out.get(String(row.dot_number));
    if (slot) slot.crash_24mo = Number(row.crash_24mo ?? 0);
  }

  const hazmatWhere = `${whereIn} and basic_desc='${HAZMAT_BASIC_DESC.replace(/'/g, "''")}'`;
  for (const row of await socrata(VIOLATION_DATASET_ID, {
    $select: "dot_number, count(*) as hazmat_viol_24mo",
    $where: hazmatWhere,
    $group: "dot_number",
  })) {
    const slot = out.get(String(row.dot_number));
    if (slot) slot.hazmat_viol_24mo = Number(row.hazmat_viol_24mo ?? 0);
  }

  return out;
}

/* --------------------------------- render --------------------------------- */

/**
 * Renders one census candidate as the text the Jev questions read. The field
 * names and layout match the sample the question instructions were written
 * against, so the prompts keep working.
 */
export function renderRecord(candidate, sms, supplementary, dist) {
  const summary = sms ? summarizeExtended(dist, sms, MEASURE_MIN_INSPECTIONS) : null;
  const drivers = candidate.driver_total || "not reported";
  const pu = candidate.nbr_power_unit || "not reported";

  const lines = [
    `USDOT ${candidate.dot_number} — ${candidate.legal_name}`,
    `DBA: ${candidate.dba_name || "—"}`,
    `Physical address: ${candidate.phy_city}, ${candidate.phy_state} ${candidate.phy_zip}`,
    `Classdef: ${candidate.classdef || "—"}`,
    `Status: Active`,
    `Drivers: ${drivers}   Power units: ${pu}`,
    `Cargo flags: ${candidate.intermodal ? "crgo_intermodal" : "none listed"}`,
    `Safety rating: ${candidate.safety_rating || "not rated"}`,
  ];

  if (!sms) {
    lines.push("SMS: no record in the FMCSA property files (no inspection history)");
  } else if (summary.insufficient) {
    lines.push(
      `SMS: only ${summary.inspTotal} inspections, below the 5-inspection floor for ranking`,
      `BASIC alerts: ${summary.alerts.length ? summary.alerts.join(", ") : "none"}`,
    );
  } else {
    lines.push(
      "SMS measures, with PortPro population rank (share of the peer population scored",
      "strictly above; higher is worse):",
    );
    for (const basic of RANKED_BASICS) {
      const value = sms[`${basic}_measure`];
      const rank = summary.ranks[basic];
      if (rank == null) continue;
      lines.push(`  ${basic.padEnd(18)} ${String(value).padStart(6)}   rank ${rank}`);
    }
    lines.push(
      `  ${"contr_subst".padEnd(18)} ${String(sms.contr_subst_measure ?? "").padStart(6)}   rank ${summary.ranks.contr_subst ?? "n/a"}`,
      `BASIC alerts: ${summary.alerts.length ? summary.alerts.join(", ") : "none"}`,
    );
  }

  lines.push(
    `Crashes 24mo: ${supplementary?.crash_24mo ?? 0}   Hazmat violations 24mo: ${supplementary?.hazmat_viol_24mo ?? 0}`,
  );

  return { text: lines.join("\n"), summary };
}

/** The recipe's own verdict, for comparison against Jev's tier. */
export function recipeVerdict(summary, safetyBandMin = 50, safetyBandMax = 74) {
  if (!summary) return { kept: false, reason: "no SMS record" };
  if (summary.insufficient) return { kept: false, reason: `only ${summary.inspTotal} inspections` };
  if (passesSafetyBand(summary, safetyBandMin, safetyBandMax, INCLUDE_BASIC_ALERT)) {
    const why = summary.alerts.length && !(summary.maxPct >= safetyBandMin && summary.maxPct <= safetyBandMax)
      ? `alert override (alert: ${summary.alerts.join(",")}; rank ${summary.maxPct})`
      : `rank ${summary.maxPct} in [${safetyBandMin},${safetyBandMax}]`;
    return { kept: true, reason: why };
  }
  return { kept: false, reason: `rank ${summary.maxPct} outside [${safetyBandMin},${safetyBandMax}], no alert` };
}
