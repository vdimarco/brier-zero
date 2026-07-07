// Ask every model the SAME prompt about a fixture, before kickoff, and store
// the probabilities it commits to. One OpenRouter key covers the whole roster.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProbs, predictionMarket } from './scoring.js';
import { getPrediction, savePrediction } from './store.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadModels() {
  const file = path.join(root, 'models.config.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).models;
}

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const DEMO = process.env.DEMO_MODE === '1';

export function predictorReady() {
  return DEMO || Boolean(process.env.OPENROUTER_API_KEY);
}

// Every model gets this exact prompt: the competition is "same prompt,
// different brains". It deliberately includes no odds or hints.
// Group-stage matches price the 90-minute result (home/draw/away);
// knockout matches price who advances (two outcomes, no draw).
export function buildPrompt(match) {
  const fixture = [
    ``,
    `Match: ${match.home.name} vs ${match.away.name}`,
    `Stage: ${match.stage}`,
    `Kickoff (UTC): ${match.kickoff}`,
    `Venue: ${match.venue || 'unknown'}`,
    ``,
    `Respond with ONLY a JSON object, no markdown, in exactly this shape:`,
  ];
  if ((match.market ?? 'regulation') === 'advance') {
    return [
      `You are entering a forecasting competition scored by Brier score (lower is better).`,
      `Forecast the FIFA World Cup 2026 knockout match below. Give your honest probabilities that each team advances, i.e. wins the tie, whether in 90 minutes, extra time, or on penalties.`,
      ...fixture,
      `{"home": <P(${match.home.name} advances)>, "away": <P(${match.away.name} advances)>, "rationale": "<one sentence>"}`,
      `The two probabilities must sum to 1.`,
    ].join('\n');
  }
  return [
    `You are entering a forecasting competition scored by Brier score (lower is better).`,
    `Forecast the FIFA World Cup 2026 match below. Give your honest probabilities for the result after 90 minutes of regulation time (extra time and penalties count as a draw).`,
    ...fixture,
    `{"home": <P(${match.home.name} wins in 90')>, "draw": <P(draw in 90')>, "away": <P(${match.away.name} wins in 90')>, "rationale": "<one sentence>"}`,
    `The three probabilities must sum to 1.`,
  ].join('\n');
}

export function parsePrediction(text, market = 'regulation') {
  if (typeof text !== 'string') return null;
  // Tolerate markdown fences and prose around the JSON object.
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const probs = normalizeProbs(obj, market);
  if (!probs) return null;
  return { probs, rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 400) : '' };
}

// Deterministic pseudo-forecaster so the whole pipeline can be exercised
// without an API key. Clearly flagged `demo: true` end to end.
function demoPredict(modelId, match) {
  const market = match.market ?? 'regulation';
  let h = 0;
  for (const ch of `${modelId}:${match.id}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = 0.15 + ((h % 1000) / 1000) * 0.55;
  const b = 0.12 + (((h >> 10) % 1000) / 1000) * 0.28;
  const probs =
    market === 'advance'
      ? normalizeProbs({ home: a, away: 1 - a }, market)
      : normalizeProbs({ home: a, draw: b, away: Math.max(0.05, 1 - a - b) }, market);
  return { probs, rationale: 'Demo mode: deterministic placeholder, not a real model call.' };
}

async function callOpenRouter(modelId, prompt) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/vdimarco/brier-zero',
      'X-Title': 'brier-zero',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `OpenRouter HTTP ${res.status}`);
  }
  return body?.choices?.[0]?.message?.content ?? '';
}

// Collect a prediction from one model for one match. Idempotent: an existing
// successful prediction is never overwritten (forecasts are commitments), but
// a previous failure is retried. One exception: if the match's market changed
// (a knockout fixture forecast under the old 90-minute market) and kickoff
// has not passed, the forecast is re-collected in the current market. Once
// the match kicks off the old commitment is locked and kept.
export async function predictOne(model, match) {
  if (match.teamsTbd) return { model: model.id, status: 'skipped-tbd' };
  const startedBeforeKickoff = Date.now() < new Date(match.kickoff).getTime();
  const existing = await getPrediction(match.id, model.id);
  if (existing?.probs) {
    const sameMarket = predictionMarket(existing) === (match.market ?? 'regulation');
    if (sameMarket || !startedBeforeKickoff) return { model: model.id, status: 'exists' };
  }

  const startedAt = Date.now();
  let record;
  try {
    let parsed;
    if (DEMO) {
      parsed = demoPredict(model.id, match);
    } else {
      const text = await callOpenRouter(model.id, buildPrompt(match));
      parsed = parsePrediction(text, match.market);
      if (!parsed) throw new Error(`unparseable response: ${String(text).slice(0, 120)}`);
    }
    record = {
      probs: parsed.probs,
      rationale: parsed.rationale,
      market: match.market ?? 'regulation',
      // The fixture this forecast priced. If ESPN later swaps the teams on
      // this event id, the mismatch voids the forecast instead of scoring it.
      fixture: `${match.home.name} vs ${match.away.name}`,
      createdAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      // Only forecasts made before kickoff count toward the leaderboard.
      eligible: startedBeforeKickoff && Date.now() < new Date(match.kickoff).getTime(),
      demo: DEMO || undefined,
    };
  } catch (err) {
    record = {
      probs: null,
      error: String(err.message || err).slice(0, 300),
      createdAt: new Date().toISOString(),
      eligible: false,
      demo: DEMO || undefined,
    };
  }
  await savePrediction(match.id, model.id, record);
  return { model: model.id, status: record.probs ? 'ok' : 'error', error: record.error };
}

// Backfill: retroactively forecast an already-finished match with the SAME
// pre-kickoff prompt (which contains no result information). Sound for this
// tournament because every model's training data predates it, but these
// records lack the pre-kickoff timestamp guarantee, so they carry retro: true
// and are badged in the UI.
export async function backfillMatches(matches, models = loadModels()) {
  const results = [];
  for (const match of matches) {
    const settled = await Promise.allSettled(
      models.map(async (model) => {
        const existing = await getPrediction(match.id, model.id);
        if (existing?.probs) return { model: model.id, status: 'exists' };
        const startedAt = Date.now();
        let parsed;
        if (DEMO) {
          parsed = demoPredict(model.id, match);
        } else {
          const text = await callOpenRouter(model.id, buildPrompt(match));
          parsed = parsePrediction(text, match.market);
          if (!parsed) throw new Error(`unparseable response`);
        }
        await savePrediction(match.id, model.id, {
          probs: parsed.probs,
          rationale: parsed.rationale,
          market: match.market ?? 'regulation',
          fixture: `${match.home.name} vs ${match.away.name}`,
          createdAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          eligible: true,
          retro: true,
          demo: DEMO || undefined,
        });
        return { model: model.id, status: 'ok' };
      })
    );
    results.push({
      matchId: match.id,
      shortName: match.shortName,
      models: settled.map((s) =>
        s.status === 'fulfilled' ? s.value : { status: 'error', error: String(s.reason).slice(0, 120) }
      ),
    });
  }
  return results;
}

// Outright winner market: probability per remaining team of lifting the
// trophy. Collected periodically; each entry is one point on the trophy
// race chart.
export function buildOutrightPrompt(teams) {
  return [
    `You are entering a forecasting competition scored by Brier score (lower is better).`,
    `These teams remain in the FIFA World Cup 2026:`,
    teams.join(', '),
    ``,
    `Give your honest probability that each team wins the tournament.`,
    `Respond with ONLY a JSON object, no markdown, in exactly this shape:`,
    `{"probabilities": {${teams.map((t) => `"${t}": <P>`).join(', ')}}, "rationale": "<one sentence>"}`,
    `Use exactly these team names as keys. The probabilities must sum to 1.`,
  ].join('\n');
}

export function parseOutright(text, teams) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = obj.probabilities ?? obj;
  const byLower = new Map(teams.map((t) => [t.toLowerCase(), t]));
  const probs = Object.fromEntries(teams.map((t) => [t, 0]));
  let sum = 0;
  for (const [k, v] of Object.entries(raw)) {
    const team = byLower.get(String(k).toLowerCase().trim());
    const p = Number(v);
    if (!team || !Number.isFinite(p) || p < 0) continue;
    probs[team] = p;
    sum += p;
  }
  if (sum < 0.7 || sum > 1.3) return null;
  for (const t of teams) probs[t] = probs[t] / sum;
  return { probs, rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 400) : '' };
}

// opts.at/opts.retro/opts.label let a caller backfill a historical round
// boundary (e.g. "the field as it stood at the start of the round of 16")
// instead of stamping the entry with the current moment.
export async function collectOutright(teams, models = loadModels(), opts = {}) {
  const { saveOutright } = await import('./store.js');
  const settled = await Promise.allSettled(
    models.map(async (model) => {
      if (DEMO) {
        const probs = Object.fromEntries(teams.map((t, i) => [t, (i + 1)]));
        const total = Object.values(probs).reduce((a, b) => a + b, 0);
        for (const t of teams) probs[t] /= total;
        return { model: model.id, probs, rationale: 'Demo placeholder.' };
      }
      const text = await callOpenRouter(model.id, buildOutrightPrompt(teams));
      const parsed = parseOutright(text, teams);
      if (!parsed) throw new Error('unparseable outright response');
      return { model: model.id, ...parsed };
    })
  );
  const entry = { at: opts.at ?? new Date().toISOString(), teams, models: {} };
  if (opts.retro) entry.retro = true;
  if (opts.label) entry.label = opts.label;
  let ok = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      entry.models[s.value.model] = { probs: s.value.probs, rationale: s.value.rationale };
      ok++;
    }
  }
  if (ok > 0) await saveOutright(entry);
  return { ok, failed: models.length - ok };
}

// In-play re-forecast: same market as the locked forecast, but the model
// knows the current score and minute. Never stored as the scored forecast.
export function buildLivePrompt(match) {
  const state = [
    ``,
    `Match: ${match.home.name} vs ${match.away.name}`,
    `Stage: ${match.stage}`,
    `Current score: ${match.home.name} ${match.home.score ?? 0} - ${match.away.score ?? 0} ${match.away.name}`,
    `Match clock: ${match.status.detail}`,
    `Key events so far: ${match.keyEvents?.length ? match.keyEvents.join('; ') : 'none'}`,
    ``,
    `Respond with ONLY a JSON object, no markdown, in exactly this shape:`,
  ];
  if ((match.market ?? 'regulation') === 'advance') {
    return [
      `You are giving a LIVE in-play forecast for a FIFA World Cup 2026 knockout match, scored informally by Brier score (lower is better).`,
      `Given the current state below, give your honest probabilities that each team ultimately advances, i.e. wins the tie, whether in 90 minutes, extra time, or on penalties.`,
      ...state,
      `{"home": <P(${match.home.name} advances)>, "away": <P(${match.away.name} advances)>, "rationale": "<one sentence>"}`,
      `The two probabilities must sum to 1.`,
    ].join('\n');
  }
  return [
    `You are giving a LIVE in-play forecast for a FIFA World Cup 2026 match, scored informally by Brier score (lower is better).`,
    `Given the current state below, give your honest probabilities for the FINAL result after 90 minutes of regulation (extra time and penalties count as a draw).`,
    ...state,
    `{"home": <P(${match.home.name} wins in 90')>, "draw": <P(draw in 90')>, "away": <P(${match.away.name} wins in 90')>, "rationale": "<one sentence>"}`,
    `The three probabilities must sum to 1.`,
  ].join('\n');
}

// Collect one in-play snapshot for every live match: all models, current
// score attached, appended to the snapshot ledger.
export async function snapshotMatches(liveMatches, models = loadModels()) {
  const { saveSnapshot } = await import('./store.js');
  const results = [];
  for (const match of liveMatches) {
    const settled = await Promise.allSettled(
      models.map(async (model) => {
        if (DEMO) return { model: model.id, ...demoPredict(model.id + ':' + match.status.detail, match) };
        const text = await callOpenRouter(model.id, buildLivePrompt(match));
        const parsed = parsePrediction(text, match.market);
        if (!parsed) throw new Error(`unparseable: ${String(text).slice(0, 80)}`);
        return { model: model.id, ...parsed };
      })
    );
    const entry = {
      at: new Date().toISOString(),
      detail: match.status.detail,
      score: [match.home.score ?? 0, match.away.score ?? 0],
      events: (match.keyEvents ?? []).length,
      period: match.status.name,
      market: match.market ?? 'regulation',
      models: {},
    };
    let ok = 0;
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        entry.models[s.value.model] = { probs: s.value.probs, rationale: s.value.rationale };
        ok++;
      }
    }
    if (ok > 0) await saveSnapshot(match.id, entry);
    results.push({ matchId: match.id, shortName: match.shortName, ok, failed: models.length - ok });
  }
  return results;
}

// Fan the same prompt out to the whole roster for every pending match.
export async function predictMatches(matches, models = loadModels()) {
  const results = [];
  for (const match of matches) {
    const settled = await Promise.allSettled(models.map((m) => predictOne(m, match)));
    results.push({
      matchId: match.id,
      shortName: match.shortName,
      models: settled.map((s) =>
        s.status === 'fulfilled' ? s.value : { status: 'error', error: String(s.reason) }
      ),
    });
  }
  return results;
}
