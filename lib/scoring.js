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

// Rows keep an entrant's whole story: label/icon from the entrants list
// (active roster + retired), plus a `qualified` flag so a competitor that
// joined late (a handful of scored matches) is never ranked head-to-head
// against full-tournament records. Ledger ids missing from the entrants
// list still get a row — a forecast on the books never disappears.
export function leaderboard(matches, predictions, models) {
  const makeRow = (m) => ({
    model: m.id,
    label: m.label ?? m.id,
    icon: m.icon ?? null,
    retired: Boolean(m.retired),
    qualified: true,
    scored: 0,
    retroScored: 0,
    predicted: 0,
    totalBrier: 0,
    avgBrier: null,
    perMatch: [],
  });
  const rows = models.map(makeRow);
  const byModel = new Map(rows.map((r) => [r.model, r]));

  for (const match of matches) {
    const preds = predictions[match.id];
    if (!preds) continue;
    for (const [modelId, pred] of Object.entries(preds)) {
      let row = byModel.get(modelId);
      if (!row) {
        row = makeRow({ id: modelId, retired: true });
        rows.push(row);
        byModel.set(modelId, row);
      }
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
  // An average over a couple of matches is noise next to one over a hundred:
  // a row ranks only once it has scored at least half as many matches as the
  // fullest record on the board. Unqualified rows still display — flagged,
  // sorted after the ranked field by the frontend.
  const maxScored = Math.max(0, ...rows.map((r) => r.scored));
  for (const row of rows) {
    row.qualified = row.scored * 2 >= maxScored;
  }
  return rows.sort((a, b) => {
    if (a.avgBrier == null && b.avgBrier == null) return b.predicted - a.predicted;
    if (a.avgBrier == null) return 1;
    if (b.avgBrier == null) return -1;
    return a.avgBrier - b.avgBrier;
  });
}

// The by-lab view: each lab's entrants (across mid-tournament
// substitutions) merge into one continuous record. When two members of a
// lab priced the same match — the substitution fixtures — the active
// member's forecast is the lab's official entry; a match is never counted
// twice. Rows carry `members` (entrant ids, active first) so the UI can
// show the lineage.
export function labLeaderboard(matches, predictions, entrants) {
  const labs = new Map();
  for (const m of entrants) {
    const key = m.lab ?? m.id;
    let lab = labs.get(key);
    if (!lab) {
      lab = { id: key, label: m.labLabel ?? m.label ?? key, icon: m.icon ?? null, members: [] };
      labs.set(key, lab);
    }
    if (m.labLabel) lab.label = m.labLabel;
    lab.icon ??= m.icon ?? null;
    lab.members.push(m);
  }
  const merged = {};
  for (const [matchId, byModel] of Object.entries(predictions)) {
    const row = {};
    for (const lab of labs.values()) {
      let pick = null;
      let pickRetired = true;
      for (const member of lab.members) {
        const p = byModel[member.id];
        if (!p) continue;
        if (!pick || (pickRetired && !member.retired)) {
          pick = { ...p, member: member.id };
          pickRetired = Boolean(member.retired);
        }
      }
      if (pick) row[lab.id] = pick;
    }
    // Ledger ids outside the entrants list (leaderboard() synthesizes rows
    // for them) become single-member labs so they stay visible here too.
    for (const [modelId, pred] of Object.entries(byModel)) {
      if ([...labs.values()].some((l) => l.members.some((m) => m.id === modelId))) continue;
      const lab = labs.get(modelId) ?? { id: modelId, label: modelId, icon: null, members: [{ id: modelId, retired: true }] };
      labs.set(modelId, lab);
      row[modelId] = { ...pred, member: modelId };
    }
    merged[matchId] = row;
  }
  const rows = leaderboard(matches, merged, [...labs.values()].map((l) => ({
    id: l.id, label: l.label, icon: l.icon,
    retired: l.members.every((m) => m.retired),
  })));
  for (const r of rows) {
    r.members = (labs.get(r.model)?.members ?? [{ id: r.model }]).map((m) => m.id);
  }
  return rows;
}
