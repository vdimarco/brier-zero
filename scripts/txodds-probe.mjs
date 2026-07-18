#!/usr/bin/env node
// Dump raw TxLINE payloads so the field mapping in lib/txodds.js can be
// checked against reality in seconds. Requires TXODDS_API_TOKEN in the env.
//
//   node scripts/txodds-probe.mjs                # fixtures snapshot
//   node scripts/txodds-probe.mjs <fixtureId>    # + odds & scores for it

import {
  txoddsReady, txoddsStatus, fetchFixtures, fetchOddsSnapshot,
  fetchScoresSnapshot, extractPrices, impliedProbs,
} from '../lib/txodds.js';

if (!txoddsReady()) {
  console.error('Set TXODDS_API_TOKEN first (see scripts/txodds-setup.mjs).');
  process.exit(1);
}
console.error('config:', JSON.stringify(txoddsStatus()));

const fixtureId = process.argv[2];

const fixtures = await fetchFixtures({ force: true });
console.log(`\n=== fixtures (${fixtures.length} normalized) ===`);
for (const f of fixtures.slice(0, 12)) {
  console.log(`  ${f.fixtureId}  ${f.home} vs ${f.away}  ${f.kickoff ?? '?'}`);
}
if (fixtures[0]) {
  console.log('\n=== first fixture, raw ===');
  console.log(JSON.stringify(fixtures[0].raw, null, 2).slice(0, 2000));
}

if (fixtureId) {
  console.log(`\n=== odds snapshot for ${fixtureId} ===`);
  const snap = await fetchOddsSnapshot(fixtureId, { force: true });
  console.log('parsed:', JSON.stringify(snap));
  if (snap?.prices) console.log('implied:', JSON.stringify(impliedProbs(snap.prices)));

  console.log(`\n=== scores snapshot for ${fixtureId} ===`);
  const scores = await fetchScoresSnapshot(fixtureId).catch((e) => `error: ${e.message}`);
  console.log(JSON.stringify(scores, null, 2)?.slice(0, 2000));
}
