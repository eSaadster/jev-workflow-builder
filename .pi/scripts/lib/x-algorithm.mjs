/**
 * Scoring constants from xai-org/x-algorithm, and the assumptions needed to
 * use them on Jev judgments.
 *
 * Phoenix predicts P(action) per viewer and RankingScorer sums
 * weight × P(action). The weights below are the production defaults in
 * home-mixer/params/param.rs; the multipliers are from vm-ranker/params.rs.
 *
 * The weights only make sense against *calibrated* probabilities: a report is
 * >1000x rarer than a like, which is why its weight is -234. A Jev answer is
 * not a calibrated probability, so multiplying it by -234 directly would let
 * the negative heads swamp everything (the misreading the repo warns about).
 * Instead each Jev score question returns a level relative to a typical post
 * (low / typical / high), which scales an ASSUMED per-impression base rate.
 * The base rates are ours, not X's: they are rough out-of-network B2B numbers
 * chosen so a typical post nets positive, with negatives rare.
 */

// home-mixer/params/param.rs
export const WEIGHTS = {
  favorite: 0.5,
  reply: 5.0,
  retweet: 1.0,
  quote: 5.0,
  share: 2.0,
  share_via_dm: 5.0,
  share_via_copy_link: 20.0,
  follow_author: 4.0,
  click: 0.4,
  profile_click: 0.0,
  video_open: 0.07,
  vqv: 0.0,
  dwell: 0.05,
  cont_dwell_time: 0.004, // per second of predicted dwell
  not_interested: -43.2,
  mute_author: -58.8,
  block_author: -31.2,
  report: -234.0,
  not_dwelled: -0.02,
};

// vm-ranker/params.rs and home-mixer/params/param.rs
export const MULTIPLIERS = {
  author_diversity_decay: 0.5,
  author_diversity_floor: 0.25,
  oon_weight_factor: 0.75,
  topic_oon_weight_factor: 0.5,
  cold_start_impression_threshold: 1000,
  age_filter_hours: 48,
};

// ASSUMED base rates per impression for an out-of-network B2B post.
export const BASE_RATES = {
  favorite: 0.02,
  reply: 0.002,
  retweet: 0.002,
  quote: 0.0005,
  share: 0.001,
  share_via_dm: 0.001,
  share_via_copy_link: 0.0005,
  follow_author: 0.0005,
  click: 0.01,
  video_open: 0.05,
  dwell: 0.3,
  cont_dwell_time: 3, // seconds
  not_interested: 0.0005,
  mute_author: 0.0001,
  block_author: 0.00005,
  report: 0.00001,
  not_dwelled: 0.5,
};

/**
 * Which Jev question drives which Phoenix heads. Every question is a 3-level
 * score (0 = below typical, 1 = typical, 2 = above typical). `inverse` heads
 * move the opposite way (a strong dwell answer lowers P(not dwelled)).
 */
export const QUESTION_HEADS = {
  reply: ["reply"],
  quote: ["quote"],
  share_dm: ["share_via_dm", "share"],
  bookmark_link: ["share_via_copy_link"],
  follow: ["follow_author"],
  like_repost: ["favorite", "retweet"],
  dwell: ["dwell", "cont_dwell_time", "click", "video_open", { inverse: "not_dwelled" }],
  negative: ["not_interested", "mute_author", "block_author", "report"],
};

// Level 0/1/2 -> 0.5x / 1x / 2x the base rate, continuous in between.
export function levelMultiplier(expectedLevel) {
  return 2 ** (expectedLevel - 1);
}

/**
 * Σ weight × (base rate × multiplier) for every head. `levels` maps question
 * id to its expected level (TypeSafe's continuous score, 0..2). A missing
 * question counts as typical.
 */
export function weightedScore(levels) {
  const contributions = {};

  for (const [questionId, heads] of Object.entries(QUESTION_HEADS)) {
    const m = levelMultiplier(levels[questionId] ?? 1);

    for (const head of heads) {
      const name = typeof head === "string" ? head : head.inverse;
      const factor = typeof head === "string" ? m : 1 / m;
      contributions[name] = WEIGHTS[name] * BASE_RATES[name] * factor;
    }
  }

  const total = Object.values(contributions).reduce((a, b) => a + b, 0);
  return { total, contributions };
}

export const BASELINE = weightedScore({}).total;

// Sum of the positive heads for a typical post. Positives and negatives nearly
// cancel, so dividing by the net baseline would blow small changes up; this
// keeps the scale stable.
const POSITIVE_BASELINE = Object.values(weightedScore({}).contributions)
  .filter((c) => c > 0)
  .reduce((a, b) => a + b, 0);

// 100 = a typical post; +10 = a tenth more positive value than a typical post
// earns. Relative, so the uniform OON factor cancels out.
export function scoreIndex(levels) {
  return 100 + (100 * (weightedScore(levels).total - BASELINE)) / POSITIVE_BASELINE;
}
