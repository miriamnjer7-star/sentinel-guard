// Keystroke dynamics helper.
//
// Every time a customer types their password, the browser captures the
// per-key hold time (dwell) and the gap between keys (flight). Rather than
// storing every raw sample forever, this module reduces each attempt to a
// small fixed-size feature vector, then maintains a running mean and
// variance per feature using Welford's online algorithm - the same
// "training" a heavier ML pipeline would do, just without needing a
// separate model file, a training script, or a GPU.
//
// ENROLL_SAMPLES is how many logins it takes to "finish training" a
// customer's baseline. Before that, every attempt just contributes to the
// baseline. After that, new attempts are scored against the frozen baseline.

const ENROLL_SAMPLES = 5;
const FEATURE_COUNT = 5; // [avgDwell, avgFlight, stdDwell, stdFlight, totalTime]
const FLAG_THRESHOLD = 2.5; // average z-score above this is treated as a mismatch

// Turns raw keydown/keyup timestamps (sent from the browser) into a fixed
// 5-number feature vector, regardless of how many characters were typed.
function extractFeatures(events) {
  // events: [{ key, type: 'down'|'up', t: <milliseconds> }, ...] in order
  const downTimes = {};
  const dwellTimes = [];
  const flightTimes = [];
  let lastUp = null;

  for (const e of events) {
    if (e.type === 'down') {
      downTimes[e.key] = e.t;
      if (lastUp !== null) {
        flightTimes.push(Math.max(0, e.t - lastUp));
      }
    } else if (e.type === 'up') {
      if (downTimes[e.key] !== undefined) {
        dwellTimes.push(Math.max(0, e.t - downTimes[e.key]));
        delete downTimes[e.key];
      }
      lastUp = e.t;
    }
  }

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const std = (arr, m) =>
    arr.length > 1
      ? Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1))
      : 0;

  const avgDwell = mean(dwellTimes);
  const avgFlight = mean(flightTimes);
  const stdDwell = std(dwellTimes, avgDwell);
  const stdFlight = std(flightTimes, avgFlight);
  const totalTime = events.length ? events[events.length - 1].t - events[0].t : 0;

  return [avgDwell, avgFlight, stdDwell, stdFlight, totalTime];
}

// Welford's online update: folds one new sample into the running mean (M)
// and sum-of-squared-differences (M2), for every feature at once.
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

// Compares a new attempt's features against a frozen baseline using a
// per-feature z-score (how many standard deviations away it is), then
// averages across features into one overall score.
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

module.exports = { extractFeatures, updateBaseline, scoreAttempt, blankProfile, ENROLL_SAMPLES };