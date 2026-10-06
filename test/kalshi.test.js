import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centsToProb, marketProbs, spread, executableOdds, settledOutcome,
  normalizeMarket, isEligible, selectQuestions, ELIGIBILITY,
} from '../lib/kalshi.js';
import { brierScore, coinFlipBrier } from '../lib/scoring.js';

// Shape follows Kalshi's documented market object. Kept verbatim-ish so a
// field rename upstream fails here loudly rather than silently producing
// null forecasts in the collector.
const OPEN = {
  ticker: 'KXFED-26DEC-C4.75',
  event_ticker: 'KXFED-26DEC',
  title: 'Will the Fed target rate be 4.75% or above after the December meeting?',
  subtitle: '4.75% or above',
  rules_primary: 'Resolves YES if the upper bound of the federal funds target range is 4.75% or higher.',
  status: 'open',
  yes_bid: 34,
  yes_ask: 37,
  no_bid: 63,
  no_ask: 66,
  volume: 18420,
  open_interest: 5100,
  open_time: '2026-08-01T14:00:00Z',
  close_time: '2026-12-10T19:00:00Z',
  result: '',
};

const NOW = '2026-08-30T12:00:00Z';

test('centsToProb rejects prices that are not a real two-sided quote', () => {
  assert.equal(centsToProb(37), 0.37);
  assert.equal(centsToProb(1), 0.01);
  assert.equal(centsToProb(0), null);    // no bid
  assert.equal(centsToProb(100), null);  // no ask
  assert.equal(centsToProb('nope'), null);
});

test('marketProbs takes the midpoint of the book and sums to 1', () => {
  const p = marketProbs(OPEN);
  assert.equal(p.yes, 0.355);
  assert.equal(p.no, 0.645);
  assert.equal(p.yes + p.no, 1);
});

test('an empty book midpoints to a confident-looking 0.5 — spread is what catches it', () => {
  // This is the trap: 0 bid / 100 ask has no information in it, but the
  // midpoint reads as a clean coin flip. marketProbs alone cannot tell the
  // difference, so eligibility gates on spread, not on the probability.
  const empty = { ...OPEN, yes_bid: 0, yes_ask: 100 };
  assert.equal(marketProbs(empty).yes, 0.5);
  assert.equal(spread(empty), 1);
  assert.equal(isEligible(empty, { now: NOW }), false);
});

test('executableOdds prices the ask, so the spread stays in the bankroll', () => {
  // Buying YES at 37c returns 100c: decimal 100/37. The midpoint would imply
  // 1/0.355 = 2.817, so the model has to beat the crossing cost, not the
  // fair line. Same rule the football bankroll settled under.
  assert.equal(executableOdds(OPEN, 'yes').toFixed(4), (100 / 37).toFixed(4));
  assert.equal(executableOdds(OPEN, 'no').toFixed(4), (100 / 66).toFixed(4));
  assert.ok(executableOdds(OPEN, 'yes') < 1 / marketProbs(OPEN).yes);
  assert.equal(executableOdds({ ...OPEN, yes_ask: 100 }, 'yes'), null);
});

test('settledOutcome reads only genuinely settled markets', () => {
  assert.equal(settledOutcome(OPEN), null);
  assert.equal(settledOutcome({ ...OPEN, status: 'closed', result: 'yes' }), null);
  assert.equal(settledOutcome({ ...OPEN, status: 'settled', result: 'yes' }), 'yes');
  assert.equal(settledOutcome({ ...OPEN, status: 'finalized', result: 'NO' }), 'no');
  assert.equal(settledOutcome({ ...OPEN, status: 'settled', result: '' }), null);
});

test('normalizeMarket drops venue detail and keeps what scoring needs', () => {
  const q = normalizeMarket(OPEN);
  assert.equal(q.id, 'KXFED-26DEC-C4.75');
  assert.equal(q.market, 'binary');
  assert.equal(q.venue, 'kalshi');
  assert.equal(q.closeAt, '2026-12-10T19:00:00.000Z'); // canonicalised, not echoed
  assert.equal(q.outcome, null);
  assert.equal(q.price.yes, 0.355);
  assert.equal(normalizeMarket({ ...OPEN, ticker: '' }), null);
  assert.equal(normalizeMarket({ ...OPEN, close_time: 'not a date' }), null);
});

test('isEligible enforces each threshold on its own', () => {
  assert.equal(isEligible(OPEN, { now: NOW }), true);
  assert.equal(isEligible({ ...OPEN, status: 'settled' }, { now: NOW }), false);
  assert.equal(isEligible({ ...OPEN, volume: 5 }, { now: NOW }), false);
  assert.equal(isEligible({ ...OPEN, yes_bid: 20, yes_ask: 50 }, { now: NOW }), false);
  // closes in 3 hours: inside minHoursToClose
  assert.equal(isEligible({ ...OPEN, close_time: '2026-08-30T15:00:00Z' }, { now: NOW }), false);
  // closes in 2 years: past maxDaysToClose
  assert.equal(isEligible({ ...OPEN, close_time: '2028-08-30T15:00:00Z' }, { now: NOW }), false);
});

test('selectQuestions is deterministic and liquidity-ordered', () => {
  const thin = { ...OPEN, ticker: 'B', volume: 200 };
  const deep = { ...OPEN, ticker: 'A', volume: 90000 };
  const tie1 = { ...OPEN, ticker: 'Z', volume: 500 };
  const tie2 = { ...OPEN, ticker: 'C', volume: 500 };
  const pick = selectQuestions([thin, deep, tie1, tie2], 3, { now: NOW });
  assert.deepEqual(pick.map((q) => q.id), ['A', 'C', 'Z']); // volume desc, then ticker asc
  // Same input, same output: a re-run after a crash re-picks the same set.
  assert.deepEqual(
    selectQuestions([tie2, deep, tie1, thin], 3, { now: NOW }).map((q) => q.id),
    pick.map((q) => q.id)
  );
});

test('the market scores as an entrant under the same Brier rule', () => {
  const q = normalizeMarket(OPEN);
  assert.equal(coinFlipBrier('binary'), 0.5);
  // Market said 35.5% yes and it resolved no: it scores better than a coin flip.
  const scored = brierScore(q.price, 'no', 'binary');
  assert.ok(scored < coinFlipBrier('binary'), `${scored} should beat 0.5`);
  // ...and worse than a coin flip when it resolves the other way.
  assert.ok(brierScore(q.price, 'yes', 'binary') > coinFlipBrier('binary'));
});

test('ELIGIBILITY thresholds are exported so the record documents its own filters', () => {
  assert.equal(typeof ELIGIBILITY.minHoursToClose, 'number');
  assert.equal(typeof ELIGIBILITY.maxSpread, 'number');
});
