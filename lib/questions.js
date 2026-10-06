// The perpetual record: forecasting live prediction-market questions.
//
// Same discipline as the football season, one domain removed. Every entrant
// gets the identical prompt, answers with probabilities that sum to 1, and is
// locked before the question resolves. What changes is that the supply of
// questions no longer runs out.

import { callOpenRouter, parsePrediction, isMarketModel } from './predictor.js';
import { normalizeProbs } from './scoring.js';
import { saveQuestionForecast } from './store.js';

// The prompt carries the claim, its resolution rules, and its deadline. It
// does NOT carry the market price. A model shown the line would score well by
// copying it, and the whole point of the record is whether it can beat a price
// it cannot see. Same rule the football prompt held to: no odds, no hints.
export function buildQuestionPrompt(q) {
  return [
    'You are entering a forecasting competition scored by Brier score (lower is better).',
    'Give your honest probability that the claim below resolves YES.',
    '',
    `Claim: ${q.title}`,
    q.subtitle ? `Detail: ${q.subtitle}` : null,
    q.rules ? `Resolution rules: ${q.rules}` : null,
    `Resolves by (UTC): ${q.closeAt}`,
    '',
    'Respond with ONLY a JSON object, no markdown, in exactly this shape:',
    '{"yes": <P(claim resolves YES)>, "no": <P(claim resolves NO)>, "rationale": "<one sentence>"}',
    'The two probabilities must sum to 1.',
  ].filter(Boolean).join('\n');
}

// Deterministic stand-in so the whole loop runs with no API key and no spend.
export function demoQuestionForecast(modelId, q) {
  let h = 0;
  for (const ch of `${modelId}:${q.id}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const yes = 0.1 + ((h % 1000) / 1000) * 0.8;
  return {
    probs: normalizeProbs({ yes, no: 1 - yes }, 'binary'),
    rationale: 'Demo mode: deterministic placeholder, not a real model call.',
  };
}

// One entrant, one question. Returns a record whether it succeeded or not, so
// a failed call is visible in the ledger rather than silently absent.
export async function forecastOne(model, q, { demo = process.env.DEMO_MODE === '1' } = {}) {
  const base = { model: model.id, questionId: q.id, market: 'binary', createdAt: new Date().toISOString() };

  // The market is an entrant, not a forecaster: its "forecast" is the midpoint
  // of its own book at the moment the question was entered.
  if (isMarketModel(model)) {
    if (!q.price) return { ...base, error: 'no two-sided quote' };
    return { ...base, probs: q.price, rationale: 'Midpoint of the live book at lock time.', source: 'market' };
  }

  if (demo) return { ...base, ...demoQuestionForecast(model.id, q), demo: true };

  const started = Date.now();
  try {
    const text = await callOpenRouter(model.id, buildQuestionPrompt(q));
    const parsed = parsePrediction(text, 'binary');
    if (!parsed) return { ...base, error: 'unparseable response', latencyMs: Date.now() - started };
    return { ...base, ...parsed, latencyMs: Date.now() - started };
  } catch (err) {
    return { ...base, error: String(err?.message || err).slice(0, 200), latencyMs: Date.now() - started };
  }
}

// Every entrant against one question. Runs them in parallel: they are
// independent, and a slow model should not delay the lock on the rest.
export async function forecastAll(models, q, opts = {}) {
  const records = await Promise.all(models.map((m) => forecastOne(m, q, opts)));
  let saved = 0;
  for (const r of records) {
    if (await saveQuestionForecast(q.id, r.model, r)) saved += 1;
  }
  return { records, saved, failed: records.filter((r) => !r.probs).length };
}
