import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normTeam, matchFixture, normalizeFixture, extractPrices, impliedProbs,
  advanceProbs, unwrap,
} from '../lib/txodds.js';

// ------------------------------------------------------------- de-vig ----

test('impliedProbs strips the vig and sums to 1', () => {
  // 2.10 / 3.30 / 3.40: overround ~1.073
  const { probs, overround } = impliedProbs({ home: 2.1, draw: 3.3, away: 3.4 });
  const sum = probs.home + probs.draw + probs.away;
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(overround > 1.05 && overround < 1.09);
  // proportional method: p_home = (1/2.1)/overround
  assert.ok(Math.abs(probs.home - (1 / 2.1) / overround) < 1e-12);
  assert.ok(probs.home > probs.draw && probs.draw > probs.away);
});

test('impliedProbs on a fair book returns the raw probabilities', () => {
  const { probs, overround } = impliedProbs({ home: 2, draw: 4, away: 4 });
  assert.ok(Math.abs(overround - 1) < 1e-12);
  assert.ok(Math.abs(probs.home - 0.5) < 1e-12);
});

test('advanceProbs splits the draw by relative strength and sums to 1', () => {
  const adv = advanceProbs({ home: 0.5, draw: 0.3, away: 0.2 });
  assert.ok(Math.abs(adv.home + adv.away - 1) < 1e-12);
  // home gets 0.5 + 0.3 * (0.5/0.7)
  assert.ok(Math.abs(adv.home - (0.5 + 0.3 * (0.5 / 0.7))) < 1e-12);
  // symmetric teams split the draw evenly
  const even = advanceProbs({ home: 0.35, draw: 0.3, away: 0.35 });
  assert.ok(Math.abs(even.home - 0.5) < 1e-12);
});

// ------------------------------------------------------ price extraction ----

test('extractPrices reads named price triples in several spellings', () => {
  assert.deepEqual(
    extractPrices({ HomePrice: '2.1', DrawPrice: 3.3, AwayPrice: 3.4 }),
    { home: 2.1, draw: 3.3, away: 3.4 }
  );
  assert.deepEqual(
    extractPrices({ Price1: 1.8, PriceX: 3.6, Price2: 4.5 }),
    { home: 1.8, draw: 3.6, away: 4.5 }
  );
  assert.deepEqual(
    extractPrices({ 1: 2.0, X: 3.4, 2: 3.8 }),
    { home: 2.0, draw: 3.4, away: 3.8 }
  );
});

test('extractPrices reads outcome arrays', () => {
  const msg = {
    Outcomes: [
      { Outcome: 'home', Price: 2.05 },
      { Outcome: 'draw', Price: 3.25 },
      { Outcome: 'away', Price: 3.55 },
    ],
  };
  assert.deepEqual(extractPrices(msg), { home: 2.05, draw: 3.25, away: 3.55 });
});

test('extractPrices digs through envelopes and stringified payloads', () => {
  const msg = {
    MessageId: 42,
    Ts: 1789000000,
    Payload: JSON.stringify({ prices: [
      { type: '1', odds: 2.2 }, { type: 'X', odds: 3.1 }, { type: '2', odds: 3.4 },
    ] }),
  };
  assert.deepEqual(extractPrices(msg), { home: 2.2, draw: 3.1, away: 3.4 });
});

test('extractPrices rejects junk (probabilities, partial books)', () => {
  assert.equal(extractPrices({ home: 0.45, draw: 0.3, away: 0.25 }), null); // probs, not odds
  assert.equal(extractPrices({ HomePrice: 2.1, DrawPrice: 3.3 }), null);
  assert.equal(extractPrices({}), null);
  assert.equal(extractPrices(null), null);
});

test('unwrap bounds recursion depth', () => {
  let deep = { a: 1 };
  for (let i = 0; i < 10; i++) deep = { nested: deep };
  assert.ok(Array.isArray(unwrap(deep))); // no throw, no infinite walk
});

// --------------------------------------------------------- team matching ----

test('normTeam normalizes FIFA vs common names', () => {
  assert.equal(normTeam('Korea Republic'), normTeam('South Korea'));
  assert.equal(normTeam('USA'), normTeam('United States'));
  assert.equal(normTeam('Côte d’Ivoire'), normTeam('Ivory Coast'));
  assert.equal(normTeam('Türkiye'), normTeam('Turkey'));
  assert.equal(normTeam('IR Iran'), normTeam('Iran'));
  assert.notEqual(normTeam('Korea Republic'), normTeam('Korea DPR'));
});

const espnMatch = (home, away, kickoff) => ({
  home: { name: home }, away: { name: away }, kickoff,
});

test('matchFixture matches by team pair and kickoff proximity', () => {
  const fixtures = [
    { fixtureId: '9001', home: 'Korea Republic', away: 'USA', kickoff: '2026-07-01T20:00:00Z' },
    { fixtureId: '9002', home: 'France', away: 'Brazil', kickoff: '2026-07-01T16:00:00Z' },
  ];
  const found = matchFixture(
    espnMatch('South Korea', 'United States', '2026-07-01T20:00:00Z'), fixtures
  );
  assert.equal(found.fixture.fixtureId, '9001');
  assert.equal(found.flipped, false);
});

test('matchFixture detects flipped orientation and maps sides', () => {
  const fixtures = [
    { fixtureId: '9003', home: 'Brazil', away: 'France', kickoff: '2026-07-02T16:00:00Z' },
  ];
  const found = matchFixture(espnMatch('France', 'Brazil', '2026-07-02T16:00:00Z'), fixtures);
  assert.equal(found.flipped, true);
});

test('matchFixture rejects kickoff further than six hours away', () => {
  const fixtures = [
    { fixtureId: '9004', home: 'France', away: 'Brazil', kickoff: '2026-07-05T16:00:00Z' },
  ];
  assert.equal(
    matchFixture(espnMatch('France', 'Brazil', '2026-07-02T16:00:00Z'), fixtures),
    null
  );
});

// ------------------------------------------------- fixture normalization ----

test('normalizeFixture reads envelope fixtures and honours Participant1IsHome', () => {
  const f = normalizeFixture({
    MessageId: 7,
    FixtureId: 12345,
    Participant1: 'Mexico',
    Participant2: 'Canada',
    Participant1IsHome: false,
    StartDate: '2026-07-03T02:00:00Z',
  });
  assert.equal(f.fixtureId, '12345');
  assert.equal(f.home, 'Canada');
  assert.equal(f.away, 'Mexico');
  assert.equal(f.kickoff, '2026-07-03T02:00:00.000Z');
});

test('normalizeFixture reads stringified payloads', () => {
  const f = normalizeFixture({
    Ts: 1789000000,
    Payload: JSON.stringify({
      fixtureId: 777, homeTeam: 'Spain', awayTeam: 'Argentina',
      kickoff: '2026-07-04T20:00:00Z',
    }),
  });
  assert.equal(f.fixtureId, '777');
  assert.equal(f.home, 'Spain');
});

test('normalizeFixture returns null for junk', () => {
  assert.equal(normalizeFixture({ MessageId: 1 }), null);
  assert.equal(normalizeFixture(null), null);
});
