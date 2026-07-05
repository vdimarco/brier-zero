// Ask every model the SAME prompt about a fixture, before kickoff, and store
// the probabilities it commits to. One OpenRouter key covers the whole roster.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProbs } from './scoring.js';
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
export function buildPrompt(match) {
  return [
    `You are entering a forecasting competition scored by Brier score (lower is better).`,
    `Forecast the FIFA World Cup 2026 match below. Give your honest probabilities for the result after 90 minutes of regulation time (extra time and penalties count as a draw).`,
    ``,
    `Match: ${match.home.name} vs ${match.away.name}`,
    `Stage: ${match.stage}`,
    `Kickoff (UTC): ${match.kickoff}`,
    `Venue: ${match.venue || 'unknown'}`,
    ``,
    `Respond with ONLY a JSON object, no markdown, in exactly this shape:`,
    `{"home": <P(${match.home.name} wins in 90')>, "draw": <P(draw in 90')>, "away": <P(${match.away.name} wins in 90')>, "rationale": "<one sentence>"}`,
    `The three probabilities must sum to 1.`,
  ].join('\n');
}

export function parsePrediction(text) {
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
  const probs = normalizeProbs(obj);
  if (!probs) return null;
  return { probs, rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 400) : '' };
}

// Deterministic pseudo-forecaster so the whole pipeline can be exercised
// without an API key. Clearly flagged `demo: true` end to end.
function demoPredict(modelId, match) {
  let h = 0;
  for (const ch of `${modelId}:${match.id}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = 0.15 + ((h % 1000) / 1000) * 0.55;
  const b = 0.12 + (((h >> 10) % 1000) / 1000) * 0.28;
  const probs = normalizeProbs({ home: a, draw: b, away: Math.max(0.05, 1 - a - b) });
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
// a previous failure is retried.
export async function predictOne(model, match) {
  const existing = getPrediction(match.id, model.id);
  if (existing?.probs) return { model: model.id, status: 'exists' };

  const startedBeforeKickoff = Date.now() < new Date(match.kickoff).getTime();
  const startedAt = Date.now();
  let record;
  try {
    let parsed;
    if (DEMO) {
      parsed = demoPredict(model.id, match);
    } else {
      const text = await callOpenRouter(model.id, buildPrompt(match));
      parsed = parsePrediction(text);
      if (!parsed) throw new Error(`unparseable response: ${String(text).slice(0, 120)}`);
    }
    record = {
      probs: parsed.probs,
      rationale: parsed.rationale,
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
  savePrediction(match.id, model.id, record);
  return { model: model.id, status: record.probs ? 'ok' : 'error', error: record.error };
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
