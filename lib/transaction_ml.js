// Transaction anomaly detection helper.
//
// There is no labeled fraud dataset to train a supervised model on - the
// system has never had confirmed fraud cases to learn from. Instead, this
// takes the same approach as lib/keystroke.js: build a per-customer running
// baseline from their own approved transactions using Welford's online
// algorithm, then score new transfers by how far they deviate from it.
// This is unsupervised anomaly detection, not a fixed threshold - the
// "normal" pattern is learned from each customer's own history rather
// than hard-coded.
//
// This is a THIRD signal, independent of the fixed rule in
// routes/customer.js (3x average / KES 50,000 ceiling). Either one
// flagging a transfer is enough to route it to SOC review.

const ENROLL_SAMPLES = 5;
const FEATURE_COUNT = 5; // [amount, hourOfDay, isNewRecipient, hoursSinceLastTransfer, amountToBalanceRatio]
const FLAG_THRESHOLD = 2.5; // average z-score above this is treated as anomalous

// Builds the fixed 5-number feature vector for one transfer attempt.
// All values are precomputed by the caller (routes/customer.js) from the
// database - this function is pure math, same separation as keystroke.js.
function buildFeatureVector({ amount, hourOfDay, isNewRecipient, hoursSinceLastTransfer, amountToBalanceRatio }) {
  return [
    amount,
    hourOfDay,
    isNewRecipient ? 1 : 0,
    hoursSinceLastTransfer,
    amountToBalanceRatio
  ];
}

// Welford's online update - identical approach to keystroke.js, folding
// one new sample into the running mean and sum-of-squared-differences.
function updateBaseline(profile, features) {
  const n = profile.sample_count + 1;
  const mean = profile.mean_json.slice();
  const m2 = profile.m2_json.slice();

  for (let i = 0; i < FEATURE_COUNT; i++) {
    const delta = features[i] - mean[i];
    mean[i] += delta / n;
    const delta2 = features[i] - mean[i];
    m2[i] += delta * delta2;
  }

  return {
    sample_count: n,
    mean_json: mean,
    m2_json: m2,
    enrolled: n >= ENROLL_SAMPLES
  };
}

// Scores a new attempt against the frozen baseline using a per-feature
// z-score, averaged into one overall anomaly score.
function scoreAttempt(profile, features) {
  const n = profile.sample_count;
  const zScores = [];

  for (let i = 0; i < FEATURE_COUNT; i++) {
    const variance = n > 1 ? profile.m2_json[i] / (n - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const z = stdDev > 1e-6 ? Math.abs(features[i] - profile.mean_json[i]) / stdDev : 0;
    zScores.push(z);
  }

  const avgZ = zScores.reduce((a, b) => a + b, 0) / zScores.length;
  return { zScores, avgZ, flagged: avgZ > FLAG_THRESHOLD };
}

function blankProfile() {
  return {
    sample_count: 0,
    mean_json: new Array(FEATURE_COUNT).fill(0),
    m2_json: new Array(FEATURE_COUNT).fill(0),
    enrolled: false
  };
}

module.exports = { buildFeatureVector, updateBaseline, scoreAttempt, blankProfile, ENROLL_SAMPLES };