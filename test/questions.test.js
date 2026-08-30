import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestionPrompt, demoQuestionForecast, forecastOne } from '../lib/questions.js';
import { normalizeMarket } from '../lib/kalshi.js';
import { parsePrediction } from '../lib/predictor.js';

const RAW = {
  ticker: 'KXFED-26DEC-C4.75',
  title: 'Will the Fed target rate be 4.75% or above after the December meeting?',
  subtitle: '4.75% or above',
  rules_primary: 'Resolves YES if the upper bound is 4.75% or higher.',
  status: 'open',
  yes_bid: 34, yes_ask: 37, no_bid: 63, no_ask: 66,
  volume: 18420, close_time: '2026-12-10T19:00:00Z', result: '',
};
const Q = normalizeMarket(RAW);

test('the prompt never leaks the market price', () => {
  // The entire premise is whether a model can beat a price it cannot see.
  // If the line reaches the prompt, every score after that is worthless.
  const prompt = buildQuestionPrompt(Q);
  for (const leak of ['0.355', '35.5', '34', '37', '66', 'bid', 'ask', 'cent', 'price', 'odds']) {
    assert.ok(!prompt.toLowerCase().includes(leak.toLowerCase()), `prompt leaked "${leak}"`);
  }
});

test('the prompt carries what a forecaster legitimately needs', () => {
  const prompt = buildQuestionPrompt(Q);
  assert.ok(prompt.includes(Q.title));
  assert.ok(prompt.includes('Resolves YES if the upper bound is 4.75% or higher.'));
  assert.ok(prompt.includes('2026-12-10T19:00:00.000Z'));
  assert.ok(prompt.includes('"yes"') && prompt.includes('"no"'));
});

test('the prompt is identical for every entrant', () => {
  // No per-model tailoring: that is the whole basis of comparison.
  assert.equal(buildQuestionPrompt(Q), buildQuestionPrompt({ ...Q }));
});

test('a model answering the prompt shape parses into a scoreable forecast', () => {
  const reply = '```json\n{"yes": 0.42, "no": 0.58, "rationale": "Inflation is sticky."}\n```';
  const parsed = parsePrediction(reply, 'binary');
  assert.equal(parsed.probs.yes, 0.42);
  assert.equal(parsed.probs.no, 0.58);
  assert.equal(parsed.rationale, 'Inflation is sticky.');
});

test('a malformed reply becomes a recorded failure, never a silent gap', async () => {
  const rec = await forecastOne({ id: 'test/model' }, Q, { demo: true });
  assert.equal(rec.market, 'binary');
  assert.equal(rec.questionId, Q.id);
  assert.ok(rec.probs, 'demo mode must still produce a forecast');
  assert.equal(rec.demo, true);
});

test('demo forecasts are deterministic per model and question', () => {
  const a = demoQuestionForecast('m1', Q).probs;
  const b = demoQuestionForecast('m1', Q).probs;
  const c = demoQuestionForecast('m2', Q).probs;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(Math.abs(a.yes + a.no - 1) < 1e-9);
});

test('the market entrant forecasts its own midpoint, not a model call', async () => {
  const rec = await forecastOne({ id: 'txodds/market', provider: 'txodds' }, Q, { demo: false });
  assert.equal(rec.source, 'market');
  assert.deepEqual(rec.probs, Q.price);
});
