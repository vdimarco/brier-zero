#!/usr/bin/env node
// Settle whatever has resolved since the last run, and score it.
//
//   node scripts/settle-questions.js
//   node scripts/settle-questions.js --outcomes '{"TICKER":"yes"}'   # offline
//
// Scoring reuses lib/scoring.js unchanged: a binary question is scored by the
// same multi-category Brier rule as a knockout tie, against the same
// coin-flip baseline.

import { fetchOutcomes } from '../lib/kalshi.js';
import { brierScore, coinFlipBrier, matchSkill } from '../lib/scoring.js';
import { getQuestions, settleQuestion } from '../lib/store.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

const questions = await getQuestions();
const open = Object.values(questions).filter((q) => !q.outcome);
if (!open.length) {
  console.log('Nothing open to settle.');
  process.exit(0);
}

const override = arg('outcomes');
const outcomes = override
  ? JSON.parse(override)
  : await fetchOutcomes(open.map((q) => q.id));

let settled = 0;
const scored = [];
for (const [id, outcome] of Object.entries(outcomes)) {
  if (!(await settleQuestion(id, outcome))) continue;
  settled += 1;
  const q = questions[id];
  for (const [modelId, f] of Object.entries(q.forecasts ?? {})) {
    if (!f.probs) continue;
    const brier = brierScore(f.probs, outcome, 'binary');
    if (brier === null) continue;
    scored.push({ modelId, brier, skill: matchSkill(brier, coinFlipBrier('binary')) });
  }
}

const byModel = new Map();
for (const s of scored) {
  const e = byModel.get(s.modelId) ?? { n: 0, brier: 0, skill: 0 };
  e.n += 1; e.brier += s.brier; e.skill += s.skill;
  byModel.set(s.modelId, e);
}

console.log(`${settled} questions settled, ${scored.length} forecasts scored.\n`);
if (byModel.size) {
  console.log('this run only (the standing record is the full ledger):');
  for (const [id, e] of [...byModel].sort((a, b) => a[1].brier / a[1].n - b[1].brier / b[1].n)) {
    console.log(`  ${id.padEnd(30)} n=${String(e.n).padStart(3)}  brier ${(e.brier / e.n).toFixed(4)}  skill ${(e.skill / e.n).toFixed(4)}`);
  }
}
