import test from 'node:test';
import assert from 'node:assert/strict';
import { brierScore, normalizeProbs, leaderboard, labLeaderboard, fixtureMatches, coinFlipBrier, predictionMarket } from '../lib/scoring.js';
import { regulationOutcome, advanceOutcome, marketOf, periodRank, fetchMatches } from '../lib/espn.js';
import { parsePrediction, buildPrompt, buildLivePrompt, predictOne } from '../lib/predictor.js';

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

test('advance market: two-way brier and normalization', () => {
  assert.equal(brierScore({ home: 1, away: 0 }, 'home', 'advance'), 0);
  assert.equal(brierScore({ home: 1, away: 0 }, 'away', 'advance'), 2);
  assert.ok(Math.abs(brierScore({ home: 0.5, away: 0.5 }, 'home', 'advance') - 0.5) < 1e-9);
  assert.equal(coinFlipBrier('advance'), 0.5);
  assert.ok(Math.abs(coinFlipBrier('regulation') - 2 / 3) < 1e-9);
  const ok = normalizeProbs({ home: 0.62, away: 0.4 }, 'advance');
  assert.ok(ok && Math.abs(ok.home + ok.away - 1) < 1e-9);
  // A three-way answer to a two-way question does not sum to 1 over the
  // two outcomes and is rejected.
  assert.equal(normalizeProbs({ home: 0.4, draw: 0.25, away: 0.35 }, 'advance'), null);
});

test('marketOf: knockout stages price advancement, group stage the 90-minute result', () => {
  assert.equal(marketOf({ stage: 'group stage' }), 'regulation');
  assert.equal(marketOf({ stage: '' }), 'regulation');
  for (const s of ['round of 32', 'round of 16', 'quarterfinals', 'semifinals', 'final']) {
    assert.equal(marketOf({ stage: s }), 'advance', s);
  }
});

test('advanceOutcome: winner flag, then shootout, then score', () => {
  const base = (over = {}) => ({
    status: { state: 'post', name: 'STATUS_FULL_TIME' },
    home: { score: 1, shootoutScore: null, winner: false },
    away: { score: 1, shootoutScore: null, winner: false },
    ...over,
  });
  assert.equal(advanceOutcome(base({ home: { score: 1, shootoutScore: 4, winner: true }, away: { score: 1, shootoutScore: 3, winner: false } })), 'home');
  assert.equal(advanceOutcome(base({ home: { score: 1, shootoutScore: 2, winner: false }, away: { score: 1, shootoutScore: 3, winner: false } })), 'away');
  assert.equal(advanceOutcome(base({ home: { score: 2, shootoutScore: null, winner: false }, away: { score: 0, shootoutScore: null, winner: false } })), 'home');
  assert.equal(advanceOutcome(base({ status: { state: 'in', name: '' } })), null);
  assert.equal(advanceOutcome(base()), null);
});

test('knockout prompts ask who advances, with no draw outcome', () => {
  const match = {
    home: { name: 'France', score: 1 }, away: { name: 'Morocco', score: 1 },
    stage: 'quarterfinals', kickoff: '2026-07-10T20:00Z', venue: 'Estadio Azteca',
    market: 'advance', status: { detail: "HT" }, keyEvents: [],
  };
  for (const p of [buildPrompt(match), buildLivePrompt(match)]) {
    assert.match(p, /advances/);
    assert.match(p, /two probabilities must sum to 1/);
    assert.ok(!p.includes('"draw"'), 'no draw key in the requested shape');
  }
  const parsed = parsePrediction('{"home":0.6,"away":0.4,"rationale":"form"}', 'advance');
  assert.ok(parsed);
  assert.ok(Math.abs(parsed.probs.home - 0.6) < 1e-9);
  assert.equal(parsed.probs.draw, undefined);
});

test('legacy knockout forecasts settle under the market they priced', () => {
  const models = [{ id: 'old', label: 'Old' }, { id: 'new', label: 'New' }];
  // Knockout tie: 1-1 after 90, home advanced on penalties.
  const match = {
    id: 'ko1', shortName: 'A @ B', market: 'advance',
    outcomes: { regulation: 'draw', advance: 'home' },
    outcome: 'home',
  };
  const predictions = {
    ko1: {
      old: { probs: { home: 0.4, draw: 0.3, away: 0.3 }, eligible: true }, // pre-switch, no market stamp
      new: { probs: { home: 0.7, away: 0.3 }, market: 'advance', eligible: true },
    },
  };
  assert.equal(predictionMarket(predictions.ko1.old), 'regulation');
  const rows = leaderboard([match], predictions, models);
  const byId = Object.fromEntries(rows.map((r) => [r.model, r]));
  // old scored against the 90-minute draw: .4²+.7²+.3² = 0.74
  assert.ok(Math.abs(byId.old.avgBrier - 0.74) < 1e-9);
  assert.equal(byId.old.perMatch[0].baseline, 2 / 3);
  // new scored against home advancing: .3²+.3² = 0.18
  assert.ok(Math.abs(byId.new.avgBrier - 0.18) < 1e-9);
  assert.equal(byId.new.perMatch[0].baseline, 0.5);
});

test('periodRank: periods rank forward, flappy generic statuses rank 0', () => {
  assert.ok(periodRank('STATUS_HALFTIME') > periodRank('STATUS_FIRST_HALF'));
  assert.ok(periodRank('STATUS_SECOND_HALF') > periodRank('STATUS_HALFTIME'));
  assert.ok(periodRank('STATUS_SHOOTOUT') > periodRank('STATUS_OVERTIME'));
  // The feed alternates STATUS_IN_PROGRESS with the specific half marker;
  // unranked names must never read as a period change.
  assert.equal(periodRank('STATUS_IN_PROGRESS'), 0);
  assert.equal(periodRank(undefined), 0);
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
  predictions.m1.a.retro = true;
  const rows = leaderboard(matches, predictions, models);
  assert.equal(rows[0].model, 'a');
  assert.equal(rows[0].scored, 1);
  assert.equal(rows[0].retroScored, 1, 'retro forecasts score and are counted separately');
  assert.equal(rows[0].predicted, 2);
  assert.ok(rows[0].avgBrier < rows[1].avgBrier);
  assert.equal(rows[1].model, 'b');
  assert.equal(rows[2].model, 'c');
  assert.equal(rows[2].scored, 0);
  assert.equal(rows[2].avgBrier, null);
});

test('leaderboard: ledger ids missing from the entrants list still get a row', () => {
  const models = [{ id: 'active', label: 'Active' }];
  const matches = [{ id: 'm1', outcome: 'home', shortName: 'X @ Y' }];
  const predictions = {
    m1: {
      active: { probs: { home: 0.8, draw: 0.1, away: 0.1 }, eligible: true },
      'ghost/old-slug': { probs: { home: 0.6, draw: 0.2, away: 0.2 }, eligible: true },
    },
  };
  const rows = leaderboard(matches, predictions, models);
  const ghost = rows.find((r) => r.model === 'ghost/old-slug');
  assert.ok(ghost, 'a stored forecast never disappears from the board');
  assert.equal(ghost.label, 'ghost/old-slug');
  assert.equal(ghost.retired, true);
  assert.equal(ghost.scored, 1);
});

test('leaderboard: retired entrants keep label, icon, and records', () => {
  const models = [
    { id: 'new/model', label: 'New Model', icon: '/icons/new.svg' },
    { id: 'old/model', label: 'Old Model', icon: '/icons/old.svg', retired: true },
  ];
  const matches = [{ id: 'm1', outcome: 'home', shortName: 'X @ Y' }];
  const predictions = {
    m1: { 'old/model': { probs: { home: 0.9, draw: 0.05, away: 0.05 }, eligible: true } },
  };
  const rows = leaderboard(matches, predictions, models);
  const old = rows.find((r) => r.model === 'old/model');
  assert.equal(old.label, 'Old Model');
  assert.equal(old.icon, '/icons/old.svg');
  assert.equal(old.retired, true);
  assert.equal(old.scored, 1);
});

test('leaderboard: shrunken skill keeps a tiny perfect sample below a full record', () => {
  const models = [
    { id: 'veteran', label: 'Veteran' },
    { id: 'latesub', label: 'Late Sub' },
  ];
  // Veteran scored 10 solid matches; the sub aced only the last one. Under
  // raw average Brier the sub would take #1 — shrinkage (10 phantom
  // coin-flip matches) must keep it below the earned record.
  const matches = [];
  const predictions = {};
  for (let i = 0; i < 10; i++) {
    const id = `m${i}`;
    matches.push({ id, outcome: 'home', shortName: `G${i}` });
    predictions[id] = { veteran: { probs: { home: 0.7, draw: 0.2, away: 0.1 }, eligible: true } };
  }
  predictions.m9.latesub = { probs: { home: 1, draw: 0, away: 0 }, eligible: true };
  const rows = leaderboard(matches, predictions, models);
  const vet = rows.find((r) => r.model === 'veteran');
  const sub = rows.find((r) => r.model === 'latesub');
  assert.ok(sub.avgBrier < vet.avgBrier, 'the sub has the lower (better) raw average');
  assert.ok(Math.abs(sub.avgSkill - 1) < 1e-9, 'one perfect match = +100% skill');
  assert.ok(sub.shrunkSkill < vet.shrunkSkill, 'but shrunken skill still ranks the veteran first');
  assert.equal(rows[0].model, 'veteran');
  // As the sub earns real matches, shrinkage releases: identical forecasts
  // over the same ten matches converge to the veteran's shrunken skill.
  for (let i = 0; i < 9; i++) {
    predictions[`m${i}`].latesub = { probs: { home: 0.7, draw: 0.2, away: 0.1 }, eligible: true };
  }
  predictions.m9.latesub = { probs: { home: 0.7, draw: 0.2, away: 0.1 }, eligible: true };
  const rows2 = leaderboard(matches, predictions, models);
  const vet2 = rows2.find((r) => r.model === 'veteran');
  const sub2 = rows2.find((r) => r.model === 'latesub');
  assert.ok(Math.abs(vet2.shrunkSkill - sub2.shrunkSkill) < 1e-9);
});

test('labLeaderboard: merges a lab across a substitution without double counting', () => {
  const entrants = [
    { id: 'lab/new', label: 'New', lab: 'lab', labLabel: 'Lab', icon: '/i.svg' },
    { id: 'other/solo', label: 'Solo', lab: 'other', labLabel: 'Other' },
    { id: 'lab/old', label: 'Old', lab: 'lab', labLabel: 'Lab', retired: true },
  ];
  const matches = [
    { id: 'm1', outcome: 'home', shortName: 'A @ B' },
    { id: 'm2', outcome: 'away', shortName: 'C @ D' },
  ];
  const predictions = {
    // Old model alone priced m1; both generations priced m2 (the
    // substitution match) — the active model's forecast must win.
    m1: {
      'lab/old': { probs: { home: 0.8, draw: 0.1, away: 0.1 }, eligible: true },
      'other/solo': { probs: { home: 0.5, draw: 0.3, away: 0.2 }, eligible: true },
    },
    m2: {
      'lab/old': { probs: { home: 0.9, draw: 0.05, away: 0.05 }, eligible: true },
      'lab/new': { probs: { home: 0.1, draw: 0.1, away: 0.8 }, eligible: true },
      'other/solo': { probs: { home: 0.3, draw: 0.3, away: 0.4 }, eligible: true },
    },
  };
  const rows = labLeaderboard(matches, predictions, entrants);
  const lab = rows.find((r) => r.model === 'lab');
  assert.equal(lab.label, 'Lab');
  assert.equal(lab.icon, '/i.svg');
  assert.deepEqual(lab.members, ['lab/new', 'lab/old']);
  assert.equal(lab.scored, 2, 'one continuous record, m2 counted once');
  // m2 must have scored the ACTIVE model's forecast: .1²+.1²+.2² = 0.06
  const m2 = lab.perMatch.find((p) => p.matchId === 'm2');
  assert.ok(Math.abs(m2.brier - 0.06) < 1e-9, 'active member is the lab\'s official entry');
  const other = rows.find((r) => r.model === 'other');
  assert.equal(other.scored, 2);
});

test('fetchMatches retries a transient ESPN failure then succeeds', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 2) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ events: [] }) };
  };
  try {
    const matches = await fetchMatches({ force: true });
    assert.equal(calls, 2, 'retried once after the 503');
    assert.deepEqual(matches, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchMatches does not retry a non-retriable status', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: false, status: 404 }; };
  try {
    await assert.rejects(fetchMatches({ force: true }), /HTTP 404/);
    assert.equal(calls, 1, 'a 404 fails immediately, no retry');
  } finally {
    globalThis.fetch = realFetch;
  }
});
