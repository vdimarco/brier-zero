import test from 'node:test';
import assert from 'node:assert/strict';
import { brierScore, normalizeProbs, leaderboard, fixtureMatches } from '../lib/scoring.js';
import { regulationOutcome } from '../lib/espn.js';
import { parsePrediction, buildPrompt, predictOne } from '../lib/predictor.js';

test('brier: perfect forecast scores zero', () => {
  assert.equal(brierScore({ home: 1, draw: 0, away: 0 }, 'home'), 0);
});

test('brier: maximally wrong forecast scores 2', () => {
  assert.equal(brierScore({ home: 1, draw: 0, away: 0 }, 'away'), 2);
});

test('brier: uniform prior scores 2/3', () => {
  const p = 1 / 3;
  const s = brierScore({ home: p, draw: p, away: p }, 'draw');
  assert.ok(Math.abs(s - 2 / 3) < 1e-9);
});

test('normalizeProbs: accepts small drift, rejects nonsense', () => {
  const ok = normalizeProbs({ home: 0.5, draw: 0.3, away: 0.22 });
  assert.ok(ok);
  assert.ok(Math.abs(ok.home + ok.draw + ok.away - 1) < 1e-9);
  assert.equal(normalizeProbs({ home: 0.9, draw: 0.9, away: 0.9 }), null);
  assert.equal(normalizeProbs({ home: -0.1, draw: 0.6, away: 0.5 }), null);
  assert.equal(normalizeProbs({ home: 0.5, draw: 0.5 }), null);
});

test('regulationOutcome: AET and penalties count as a 90-minute draw', () => {
  const base = {
    status: { state: 'post', name: 'STATUS_FULL_TIME' },
    home: { score: 2, shootoutScore: null },
    away: { score: 2, shootoutScore: null },
  };
  assert.equal(regulationOutcome(base), 'draw');
  assert.equal(
    regulationOutcome({ ...base, status: { state: 'post', name: 'STATUS_FINAL_PEN' }, home: { score: 1, shootoutScore: 4 }, away: { score: 1, shootoutScore: 3 } }),
    'draw'
  );
  assert.equal(
    regulationOutcome({ ...base, home: { score: 3, shootoutScore: null }, away: { score: 1, shootoutScore: null } }),
    'home'
  );
  assert.equal(regulationOutcome({ ...base, status: { state: 'in', name: '' } }), null);
});

test('parsePrediction: tolerates fences and prose, rejects garbage', () => {
  const parsed = parsePrediction('Sure! ```json\n{"home":0.5,"draw":0.28,"away":0.22,"rationale":"hosts"}\n```');
  assert.ok(parsed);
  assert.ok(Math.abs(parsed.probs.home - 0.5) < 1e-9);
  assert.equal(parsed.rationale, 'hosts');
  assert.equal(parsePrediction('I cannot predict football.'), null);
  assert.equal(parsePrediction('{"home": 2, "draw": -1, "away": 0}'), null);
});

test('prompt is identical in structure for every model (no model name inside)', () => {
  const match = {
    home: { name: 'Brazil' }, away: { name: 'Norway' },
    stage: 'round of 16', kickoff: '2026-07-05T20:00Z', venue: 'MetLife Stadium',
  };
  const p = buildPrompt(match);
  assert.match(p, /Brier score/);
  assert.match(p, /Brazil vs Norway/);
  assert.match(p, /sum to 1/);
});

test('placeholder fixtures are never forecast', async () => {
  const match = {
    id: 'tbd1', teamsTbd: true, kickoff: '2027-01-01T00:00Z',
    home: { name: 'Quarterfinal 1 Winner' }, away: { name: 'Quarterfinal 2 Winner' },
    stage: 'quarterfinal', venue: '',
  };
  const r = await predictOne({ id: 'any/model', label: 'Any' }, match);
  assert.equal(r.status, 'skipped-tbd');
});

test('a forecast priced against different teams does not score', () => {
  const match = { home: { name: 'France' }, away: { name: 'Morocco' } };
  assert.equal(fixtureMatches({ fixture: 'France vs Morocco' }, match), true);
  assert.equal(fixtureMatches({ fixture: 'RD16 W5 vs RD16 W6' }, match), false);
  assert.equal(fixtureMatches({}, match), true); // legacy records without the stamp
});

test('leaderboard: sorts by average Brier, ignores ineligible predictions', () => {
  const models = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ];
  const matches = [
    { id: 'm1', outcome: 'home', shortName: 'X @ Y' },
    { id: 'm2', outcome: null, shortName: 'P @ Q' },
  ];
  const predictions = {
    m1: {
      a: { probs: { home: 0.8, draw: 0.1, away: 0.1 }, eligible: true },
      b: { probs: { home: 0.2, draw: 0.3, away: 0.5 }, eligible: true },
      c: { probs: { home: 1, draw: 0, away: 0 }, eligible: false }, // late: excluded
    },
    m2: { a: { probs: { home: 0.5, draw: 0.3, away: 0.2 }, eligible: true } },
  };
  const rows = leaderboard(matches, predictions, models);
  assert.equal(rows[0].model, 'a');
  assert.equal(rows[0].scored, 1);
  assert.equal(rows[0].predicted, 2);
  assert.ok(rows[0].avgBrier < rows[1].avgBrier);
  assert.equal(rows[1].model, 'b');
  assert.equal(rows[2].model, 'c');
  assert.equal(rows[2].scored, 0);
  assert.equal(rows[2].avgBrier, null);
});
