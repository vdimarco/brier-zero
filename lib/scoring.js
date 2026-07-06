// Multi-category Brier score over a match's market outcomes.
// 0 is a perfect forecast ("brier zero"), 2 is maximally wrong.
//
// Two markets exist:
//   regulation (group stage): home / draw / away after 90 minutes.
//     A know-nothing (1/3, 1/3, 1/3) forecast scores 0.667.
//   advance (knockout): home / away — who wins the tie and goes through,
//     extra time and penalties included. A know-nothing (1/2, 1/2)
//     forecast scores 0.5.

export const MARKETS = {
  regulation: ['home', 'draw', 'away'],
  advance: ['home', 'away'],
};

export function marketOutcomes(market) {
  return MARKETS[market] ?? MARKETS.regulation;
}

// Records stored before markets existed are all 90-minute forecasts.
export function predictionMarket(pred) {
  return pred?.market && MARKETS[pred.market] ? pred.market : 'regulation';
}

// The score of a uniform know-nothing forecast: (n-1)/n for n outcomes.
export function coinFlipBrier(market) {
  const n = marketOutcomes(market).length;
  return (n - 1) / n;
}

export const OUTCOMES = MARKETS.regulation;

export function brierScore(probs, outcome, market = 'regulation') {
  const outcomes = marketOutcomes(market);
  if (!outcomes.includes(outcome)) return null;
  let sum = 0;
  for (const o of outcomes) {
    const p = Number(probs?.[o]);
    if (!Number.isFinite(p)) return null;
    const observed = o === outcome ? 1 : 0;
    sum += (p - observed) ** 2;
  }
  return sum;
}

// probs must be non-negative and roughly sum to 1; we renormalize small drift
// and reject nonsense so a model can't game the score with p > 1.
export function normalizeProbs(raw, market = 'regulation') {
  const outcomes = marketOutcomes(market);
  const probs = {};
  let sum = 0;
  for (const o of outcomes) {
    const p = Number(raw?.[o]);
    if (!Number.isFinite(p) || p < 0 || p > 1.0001) return null;
    probs[o] = p;
    sum += p;
  }
  if (sum < 0.9 || sum > 1.1) return null;
  for (const o of outcomes) probs[o] = probs[o] / sum;
  return probs;
}

// matches: normalized ESPN matches; predictions: store shape
// { [matchId]: { [modelId]: { probs, createdAt, eligible, market } } }
export function fixtureMatches(pred, match) {
  return !pred.fixture || pred.fixture === `${match.home.name} vs ${match.away.name}`;
}

// Every forecast is settled under the market it priced. A legacy 90-minute
// forecast on a knockout match still scores against the regulation outcome,
// which stays derivable even though new knockout forecasts price advancement.
function outcomeFor(match, market) {
  if (match.outcomes) return match.outcomes[market] ?? null;
  // Matches without the per-market map (tests, legacy shapes): the single
  // outcome only settles forecasts priced in the match's own market.
  return market === (match.market ?? 'regulation') ? match.outcome : null;
}

export function leaderboard(matches, predictions, models) {
  const rows = models.map((m) => ({
    model: m.id,
    label: m.label,
    scored: 0,
    retroScored: 0,
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
      const market = predictionMarket(pred);
      const outcome = outcomeFor(match, market);
      if (outcome && pred.eligible && fixtureMatches(pred, match)) {
        const score = brierScore(pred.probs, outcome, market);
        if (score != null) {
          row.scored += 1;
          if (pred.retro) row.retroScored += 1;
          row.totalBrier += score;
          row.perMatch.push({
            matchId: match.id,
            shortName: match.shortName,
            brier: score,
            market,
            baseline: coinFlipBrier(market),
          });
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
