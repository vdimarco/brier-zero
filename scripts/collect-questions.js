#!/usr/bin/env node
// Enter new questions into the perpetual record and lock a forecast from
// every entrant. This is the cron. It is meant to run unattended, forever.
//
//   node scripts/collect-questions.js                  # live, default 30/week cadence
//   node scripts/collect-questions.js --limit 5        # smaller batch
//   node scripts/collect-questions.js --fixture f.json # offline, from saved markets
//   DEMO_MODE=1 node scripts/collect-questions.js ...  # no API key, no spend
//
// Idempotent by construction: a question already in the record is not
// re-entered, and a forecast already locked is never overwritten.

import fs from 'node:fs';
import { fetchOpenMarkets, selectQuestions } from '../lib/kalshi.js';
import { loadModels } from '../lib/predictor.js';
import { forecastAll } from '../lib/questions.js';
import { getQuestions, saveQuestion } from '../lib/store.js';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const limit = Number(arg('limit', 30));
const fixture = arg('fixture');

const raw = fixture
  ? JSON.parse(fs.readFileSync(fixture, 'utf8'))
  : await fetchOpenMarkets({ force: true });
const markets = Array.isArray(raw) ? raw : raw?.markets ?? [];

const known = await getQuestions();
const candidates = selectQuestions(markets, limit + Object.keys(known).length);
const fresh = candidates.filter((q) => !known[q.id]).slice(0, limit);

console.log(
  `${markets.length} markets seen, ${candidates.length} eligible, ` +
  `${Object.keys(known).length} already in the record, ${fresh.length} to enter`
);

const models = loadModels();
let locked = 0;
for (const q of fresh) {
  await saveQuestion(q);
  const { saved, failed } = await forecastAll(models, q);
  locked += saved;
  const price = q.price ? `${(q.price.yes * 100).toFixed(0)}c` : 'no quote';
  console.log(`  ${q.id}  [market ${price}]  ${saved} locked, ${failed} failed  ${q.title.slice(0, 60)}`);
}

console.log(`\n${fresh.length} questions entered, ${locked} forecasts locked.`);
if (fresh.length) {
  console.log('Commit data/store.json now — the git timestamp is what makes the lock provable.');
}
