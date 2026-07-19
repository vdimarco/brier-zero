// The Bankroll: paper-trading each model's locked forecasts against the
// locked TxODDS StablePrice line, quarter-Kelly, one bet per match on the
// model's biggest positive edge. Virtual units only — never money.
//
// Deterministic by construction: a pure fold over (locked forecasts, locked
// lines, settled results) in kickoff order. No randomness, no wall clock.
// Re-running over the same ledger always reproduces the same numbers, which
// is what makes the whole table auditable bet by bet.
//
// Odds source, per market (a bet settles in the market its forecast priced,
// the same rule the leaderboard scores by — so a 90-minute forecast placed on
// a knockout fixture is still a 1X2 bet, settled by the 90-minute result):
// - regulation forecasts: the RAW 1X2 decimal line recorded in the market
//   entry's rationale at collection time ("decimal H/D/A" or
//   "(1X2 H/D/A, ...)"). Raw means the vig is still in the price — a model
//   only profits if its edge beats the bookmaker margin. oddsType: 'raw'.
// - advance forecasts (knockouts): bookmakers don't quote a single "advances"
//   price in our feed; the stored market forecast is the de-vigged two-way
//   split. Bets settle at fair odds d = 1/q. Disclosed in the UI.
//   oddsType: 'fair'.
//
// Rules (fixed):
//   edge_o      = p_o * d_o - 1
//   bet         = argmax edge_o, only if edge > EDGE_MIN (2%)
//   full Kelly  = (p*d - 1) / (d - 1)
//   stake       = min(KELLY_FRACTION * f*, STAKE_CAP) * bankroll,
//                 floored to 0 when below MIN_STAKE (no dust)
//   win         → bankroll += stake * (d - 1);  loss → bankroll -= stake
// Only the pre-kickoff locked forecast and pre-kickoff line ever bet;
// in-play snapshots never do. The Market itself sits out: betting at its
// own odds is zero-edge by construction.

import { marketOutcomes, predictionMarket, fixtureMatches } from './scoring.js';

export const STARTING_BANKROLL = 1000;
export const EDGE_MIN = 0.02;
export const KELLY_FRACTION = 0.25;
export const STAKE_CAP = 0.10;
export const MIN_STAKE = 0.5;
const MARKET_ID = 'txodds/market';

// The raw 1X2 decimals frozen into the market record's rationale at
// collection time. Two historical phrasings, one regex each.
export function parseRawOdds(rationale = '') {
  const m = /(?:decimal|1X2) ([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(rationale);
  if (!m) return null;
  const [home, draw, away] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![home, draw, away].every((d) => Number.isFinite(d) && d > 1)) return null;
  return { home, draw, away };
}

// The line a bet settles at for this match, or null when the market never
// priced it. { odds: {outcome: decimal}, oddsType: 'raw'|'fair' }
export function lineFor(match, marketPred, market = match.market ?? 'regulation') {
  if (!marketPred?.probs) return null;
  if (market === 'regulation') {
    const raw = parseRawOdds(marketPred.rationale);
    if (raw) return { odds: raw, oddsType: 'raw' };
    // Fall back to fair odds if a record predates the rationale format.
    const fair = {};
    for (const o of marketOutcomes('regulation')) {
      if (!(marketPred.probs[o] > 0)) return null;
      fair[o] = 1 / marketPred.probs[o];
    }
    return { odds: fair, oddsType: 'fair' };
  }
  // advance: fair odds from the de-vigged two-way split.
  const fair = {};
  for (const o of marketOutcomes('advance')) {
    if (!(marketPred.probs[o] > 0)) return null;
    fair[o] = 1 / marketPred.probs[o];
  }
  return { odds: fair, oddsType: 'fair' };
}

const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;

// Pure fold. matches: resolved fixture objects (any order — sorted here);
// predictions: ledger keyed [matchId][modelId]; entrants: model list.
// Returns { models: {modelId: summary}, bets: [...] } — bets in settle order.
export function computeBankrolls(matches, predictions, entrants) {
  const settled = matches
    .filter((m) => m.status?.state === 'post' && m.outcome && !m.teamsTbd)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || String(a.id).localeCompare(String(b.id)));

  const state = new Map(); // modelId -> summary
  const modelFor = (id) => {
    if (!state.has(id)) {
      state.set(id, {
        model: id,
        bankroll: STARTING_BANKROLL,
        betsPlaced: 0, wins: 0, losses: 0, noBets: 0,
        biggestWin: null, biggestLoss: null,
        series: [], // { matchId, after } — bankroll after each priced match
      });
    }
    return state.get(id);
  };

  const bets = [];
  for (const match of settled) {
    const preds = predictions[match.id];
    if (!preds) continue;
    const outcomeIn = (market) =>
      match.outcomes
        ? match.outcomes[market] ?? null
        : market === (match.market ?? 'regulation') ? match.outcome : null;

    for (const entrant of entrants) {
      const modelId = entrant.id;
      if (modelId === MARKET_ID) continue; // can't bet against itself
      const pred = preds[modelId];
      // Same lock discipline as scoring: an eligible pre-kickoff forecast.
      if (!pred?.probs || !pred.eligible || !fixtureMatches(pred, match)) continue;
      // A bet settles in the market the forecast priced — the same rule the
      // leaderboard scores by. A 90-minute forecast on a knockout fixture is
      // a 1X2 bet on the raw line settled by the 90-minute result; an
      // advance forecast settles at fair two-way odds.
      const market = predictionMarket(pred);
      const outs = marketOutcomes(market);
      const outcome = outcomeIn(market);
      if (!outcome) continue;
      const line = lineFor(match, preds[MARKET_ID], market);
      if (!line) continue; // the market never priced this line → no bet possible

      const s = modelFor(modelId);
      let best = null;
      for (const o of outs) {
        const p = pred.probs[o];
        const d = line.odds[o];
        if (!(p > 0) || !(d > 1)) continue;
        const edge = p * d - 1;
        if (!best || edge > best.edge) best = { outcome: o, prob: p, odds: d, edge };
      }

      const row = {
        matchId: match.id,
        shortName: match.shortName,
        market,
        modelId,
        oddsType: line.oddsType,
        bankrollBefore: round2(s.bankroll),
      };

      let stake = 0;
      if (best && best.edge > EDGE_MIN) {
        const fullKelly = (best.prob * best.odds - 1) / (best.odds - 1);
        const fraction = Math.min(KELLY_FRACTION * fullKelly, STAKE_CAP);
        stake = fraction * s.bankroll;
        if (stake < MIN_STAKE) stake = 0;
        row.outcome = best.outcome;
        row.prob = round4(best.prob);
        row.odds = round4(best.odds);
        row.edge = round4(best.edge);
        row.stakeFraction = round4(fraction);
      }

      if (stake === 0) {
        row.result = 'no_bet';
        row.stake = 0;
        row.pnl = 0;
        row.bankrollAfter = round2(s.bankroll);
        s.noBets++;
      } else {
        const won = best.outcome === outcome;
        const pnl = won ? stake * (best.odds - 1) : -stake;
        s.bankroll += pnl;
        row.result = won ? 'win' : 'loss';
        row.stake = round2(stake);
        row.pnl = round2(pnl);
        row.bankrollAfter = round2(s.bankroll);
        s.betsPlaced++;
        if (won) s.wins++; else s.losses++;
        if (pnl > 0 && (!s.biggestWin || pnl > s.biggestWin.pnl)) {
          s.biggestWin = { matchId: match.id, shortName: match.shortName, pnl: round2(pnl) };
        }
        if (pnl < 0 && (!s.biggestLoss || pnl < s.biggestLoss.pnl)) {
          s.biggestLoss = { matchId: match.id, shortName: match.shortName, pnl: round2(pnl) };
        }
      }
      s.series.push({ matchId: match.id, after: round2(s.bankroll) });
      bets.push(row);
    }
  }

  const models = {};
  for (const [id, s] of state) {
    models[id] = { ...s, bankroll: round2(s.bankroll) };
  }
  return { models, bets, startingBankroll: STARTING_BANKROLL };
}
