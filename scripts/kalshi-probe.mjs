#!/usr/bin/env node
// Run this once from a networked shell before trusting the cron.
//
// lib/kalshi.js was written against Kalshi's documented market object but
// could not be checked against a live response from the machine that wrote
// it (outbound HTTPS was blocked). This prints the real shape and names any
// field the adapter expects and does not find.

import { fetchOpenMarkets, normalizeMarket, isEligible, selectQuestions } from '../lib/kalshi.js';

const EXPECTED = [
  'ticker', 'event_ticker', 'title', 'status', 'yes_bid', 'yes_ask',
  'no_bid', 'no_ask', 'volume', 'open_interest', 'close_time', 'result',
];

const markets = await fetchOpenMarkets({ force: true, max: 200 });
console.log(`fetched ${markets.length} open markets\n`);

const sample = markets[0];
if (!sample) {
  console.log('No markets returned. Check the API base URL and the status filter.');
  process.exit(1);
}

console.log('keys on a live market object:');
console.log('  ' + Object.keys(sample).sort().join('\n  '));

const missing = EXPECTED.filter((k) => !(k in sample));
console.log(`\nfields lib/kalshi.js expects: ${missing.length ? 'MISSING ' + missing.join(', ') : 'all present'}`);

console.log('\nfirst market, normalised:');
console.log(JSON.stringify(normalizeMarket(sample), null, 2));

const eligible = markets.filter((m) => isEligible(m));
console.log(`\n${eligible.length} of ${markets.length} pass eligibility`);
console.log('top 5 by liquidity:');
for (const q of selectQuestions(markets, 5)) {
  console.log(`  ${q.id.padEnd(28)} vol ${String(q.volume).padStart(8)}  ${(q.price.yes * 100).toFixed(0)}c  ${q.title.slice(0, 55)}`);
}
