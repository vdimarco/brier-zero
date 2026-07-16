// Reusable retro backtest: run ANY OpenRouter model against already-played
// matches using the EXACT locked pre-kickoff prompt, score it with the same
// Brier math as the leaderboard, and compare it with the locked field.
//
// Honesty contract: a backtest is not a locked forecast. The prompt contains
// no result information and the models' training data predates the
// tournament, but a backtest record lacks the pre-kickoff timestamp proof.
// Reports carry `method: "retro-backtest"` and, if stored into the ledger
// (opt-in via { store: true }), records are flagged `retro: true,
// backtest: true` so the UI stars them — same convention as backfill.
//
// Read-only by default: results are returned (and written to data/backtests/
// by the CLI), never into the ledger unless explicitly asked.

import { fetchMatches } from './espn.js';
import {
  buildPrompt, parsePrediction, callOpenRouter, demoPredict, loadModels,
} from './predictor.js';
import { brierScore, coinFlipBrier, predictionMarket, fixtureMatches } from './scoring.js';
import { getPredictions, savePrediction } from './store.js';

const DEMO = process.env.DEMO_MODE === '1';

// Settle a stored prediction against the match, mirroring lib/scoring.js:
// each forecast scores under the market it priced.
function settledBrier(pred, match) {
  if (!pred?.probs || !pred.eligible || !fixtureMatches(pred, match)) return null;
  const market = predictionMarket(pred);
  const outcome = match.outcomes?.[market] ?? (market === (match.market ?? 'regulation') ? match.outcome : null);
  if (!outcome) return null;
  return brierScore(pred.probs, outcome, market);
}

async function backtestOne(model, match) {
  const startedAt = Date.now();
  const prompt = buildPrompt(match);
  let parsed;
  if (DEMO) {
    parsed = demoPredict(`backtest:${model}`, match);
  } else {
    const text = await callOpenRouter(model, prompt);
    parsed = parsePrediction(text, match.market);
    if (!parsed) throw new Error(`unparseable response: ${String(text).slice(0, 120)}`);
  }
  return { ...parsed, latencyMs: Date.now() - startedAt };
}

// opts:
//   model        (required) OpenRouter slug, e.g. "google/gemini-3.1-pro-preview"
//   label        display name for the report (default: slug)
//   matchIds     array of ESPN event ids; omit (or null) for all resolved matches
//   store        also write retro+backtest records into the ledger (default false)
//   concurrency  parallel OpenRouter calls (default 3)
export async function backtestModel(opts = {}) {
  const { model, label = opts.model, matchIds = null, store = false, concurrency = 3 } = opts;
  if (!model) throw new Error('backtestModel: opts.model (OpenRouter slug) is required');
  if (!DEMO && !process.env.OPENROUTER_API_KEY) {
    throw new Error('Set OPENROUTER_API_KEY (or DEMO_MODE=1) first.');
  }

  const wanted = matchIds ? new Set(matchIds.map(String)) : null;
  const all = await fetchMatches();
  const targets = all.filter(
    (m) => m.status.state === 'post' && !m.teamsTbd && m.outcome && (!wanted || wanted.has(m.id))
  );
  if (wanted) {
    for (const id of wanted) {
      if (!targets.some((m) => m.id === id)) {
        throw new Error(`match ${id} not found among resolved fixtures`);
      }
    }
  }
  if (!targets.length) throw new Error('no resolved matches to backtest');

  const predictions = await getPredictions();
  const roster = loadModels();
  const rows = [];

  // Small concurrency pool: kind to OpenRouter, fast enough for full runs.
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const match = targets[next++];
      const row = {
        matchId: match.id,
        shortName: match.shortName,
        fixture: `${match.home.name} vs ${match.away.name}`,
        stage: match.stage,
        market: match.market ?? 'regulation',
        outcome: match.outcome,
        score: `${match.home.score ?? '?'}-${match.away.score ?? '?'}`,
        baseline: coinFlipBrier(match.market),
      };
      try {
        const got = await backtestOne(model, match);
        row.probs = got.probs;
        row.rationale = got.rationale;
        row.latencyMs = got.latencyMs;
        row.brier = brierScore(got.probs, match.outcome, match.market);

        // The locked field on this match, settled exactly like the leaderboard.
        const field = {};
        for (const mod of roster) {
          const pred = predictions[match.id]?.[mod.id];
          const s = settledBrier(pred, match);
          if (s != null) field[mod.id] = { label: mod.label, brier: s, retro: Boolean(pred.retro) };
        }
        const scores = Object.values(field).map((f) => f.brier);
        row.field = field;
        row.fieldMean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        row.rankVsField = scores.length
          ? 1 + scores.filter((s) => s < row.brier - 1e-12).length
          : null;
        row.fieldSize = scores.length;

        if (store) {
          await savePrediction(match.id, model, {
            probs: got.probs,
            rationale: got.rationale,
            market: match.market ?? 'regulation',
            fixture: row.fixture,
            createdAt: new Date().toISOString(),
            latencyMs: got.latencyMs,
            eligible: true,
            retro: true,
            backtest: true,
            demo: DEMO || undefined,
          });
        }
      } catch (err) {
        row.error = String(err.message || err).slice(0, 300);
      }
      rows.push(row);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  rows.sort((a, b) => new Date(a.matchId) - new Date(b.matchId) || a.matchId.localeCompare(b.matchId));
  const ok = rows.filter((r) => r.brier != null);

  // Roster averages over the SAME match set, for a like-for-like ranking.
  const rosterAvg = roster
    .map((mod) => {
      const scores = ok
        .map((r) => r.field[mod.id]?.brier)
        .filter((s) => s != null);
      return scores.length
        ? { model: mod.id, label: mod.label, scored: scores.length, avgBrier: scores.reduce((a, b) => a + b, 0) / scores.length }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.avgBrier - b.avgBrier);

  const avgBrier = ok.length ? ok.reduce((a, r) => a + r.brier, 0) / ok.length : null;
  return {
    method: 'retro-backtest',
    note: 'Same locked pre-kickoff prompt, run after full time. No result information in the prompt; no pre-kickoff timestamp proof. Not eligible for the live leaderboard.',
    model,
    label,
    at: new Date().toISOString(),
    demo: DEMO || undefined,
    stored: Boolean(store),
    matches: rows,
    summary: {
      requested: targets.length,
      scored: ok.length,
      failed: rows.length - ok.length,
      avgBrier,
      avgBaseline: ok.length ? ok.reduce((a, r) => a + r.baseline, 0) / ok.length : null,
      fieldAvgSameMatches: ok.length && ok.every((r) => r.fieldMean != null)
        ? ok.reduce((a, r) => a + r.fieldMean, 0) / ok.length
        : null,
      beatFieldMean: ok.filter((r) => r.fieldMean != null && r.brier < r.fieldMean).length,
      rosterAvgSameMatches: rosterAvg,
      wouldRank: avgBrier != null
        ? 1 + rosterAvg.filter((r) => r.avgBrier < avgBrier - 1e-12).length
        : null,
      rosterSize: rosterAvg.length,
    },
  };
}
