// Multi-category Brier score over the three 90-minute outcomes.
// 0 is a perfect forecast ("brier zero"), 2 is maximally wrong.
// A know-nothing forecast of (1/3, 1/3, 1/3) scores 0.667 on every match.

export const OUTCOMES = ['home', 'draw', 'away'];

export function brierScore(probs, outcome) {
  if (!OUTCOMES.includes(outcome)) return null;
  let sum = 0;
  for (const o of OUTCOMES) {
    const p = Number(probs?.[o]);
    if (!Number.isFinite(p)) return null;
    const observed = o === outcome ? 1 : 0;
    sum += (p - observed) ** 2;
  }
  return sum;
}

// probs must be non-negative and roughly sum to 1; we renormalize small drift
// and reject nonsense so a model can't game the score with p > 1.
export function normalizeProbs(raw) {
  const probs = {};
  let sum = 0;
  for (const o of OUTCOMES) {
    const p = Number(raw?.[o]);
    if (!Number.isFinite(p) || p < 0 || p > 1.0001) return null;
    probs[o] = p;
    sum += p;
  }
  if (sum < 0.9 || sum > 1.1) return null;
  for (const o of OUTCOMES) probs[o] = probs[o] / sum;
  return probs;
}

// matches: normalized ESPN matches; predictions: store shape
// { [matchId]: { [modelId]: { probs, createdAt, eligible } } }
export function leaderboard(matches, predictions, models) {
  const rows = models.map((m) => ({
    model: m.id,
    label: m.label,
    scored: 0,
    predicted: 0,
    totalBrier: 0,
    avgBrier: null,
    perMatch: [],
  }));
  const byModel = new Map(rows.map((r) => [r.model, r]));

  for (const match of matches) {
    const preds = predictions[match.id];
    if (!preds) continue;
    for (const [modelId, pred] of Object.entries(preds)) {
      const row = byModel.get(modelId);
      if (!row) continue;
      row.predicted += 1;
      if (match.outcome && pred.eligible) {
        const score = brierScore(pred.probs, match.outcome);
        if (score != null) {
          row.scored += 1;
          row.totalBrier += score;
          row.perMatch.push({ matchId: match.id, shortName: match.shortName, brier: score });
        }
      }
    }
  }
  for (const row of rows) {
    row.avgBrier = row.scored ? row.totalBrier / row.scored : null;
  }
  return rows.sort((a, b) => {
    if (a.avgBrier == null && b.avgBrier == null) return b.predicted - a.predicted;
    if (a.avgBrier == null) return 1;
    if (b.avgBrier == null) return -1;
    return a.avgBrier - b.avgBrier;
  });
}
