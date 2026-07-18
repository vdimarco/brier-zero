import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPrices, isFullTimeMatchOdds } from '../lib/txodds.js';

// Verbatim live devnet message (fixture 17588223, pre-kickoff).
const REAL_MSG = {
  FixtureId: 17588223,
  MessageId: '1834121764:00003:000158-10021-stab',
  Ts: 1781827494317,
  Bookmaker: 'TXLineStablePriceDemargined',
  BookmakerId: 10021,
  SuperOddsType: '1X2_PARTICIPANT_RESULT',
  GameState: null,
  InRunning: false,
  MarketParameters: null,
  MarketPeriod: 'half=1',
  PriceNames: ['part1', 'draw', 'part2'],
  Prices: [2888, 2214, 4951],
  Pct: ['34.626', '45.167', '20.198'],
};

test('extractPrices parses TxLINE parallel PriceNames/Prices arrays (thousandths)', () => {
  assert.deepEqual(extractPrices(REAL_MSG), { home: 2.888, draw: 2.214, away: 4.951 });
});

test('isFullTimeMatchOdds accepts only 1X2 full-match messages', () => {
  const overUnder = { ...REAL_MSG, SuperOddsType: 'OVERUNDER_PARTICIPANT_GOALS', MarketPeriod: null };
  assert.equal(isFullTimeMatchOdds(overUnder), false);

  const halfTime = { ...REAL_MSG, MarketPeriod: 'half=1' };
  assert.equal(isFullTimeMatchOdds(halfTime), false);

  const fullTime = { ...REAL_MSG, MarketPeriod: null };
  assert.equal(isFullTimeMatchOdds(fullTime), true);
});
