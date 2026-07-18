// CLI: retro-backtest any OpenRouter model against already-played matches
// with the exact locked prompt, and compare it with the locked field.
//
//   node scripts/backtest.js --model google/gemini-3.1-pro-preview \
//     [--label Gemini] [--matches 760514,760515 | --all] [--store] \
//     [--concurrency 3] [--out data/backtests/gemini.json]
//
// Default is a dry run: report only (printed + written to data/backtests/),
// nothing enters the ledger. --store writes retro+backtest-flagged records.

import fs from 'node:fs';
import path from 'node:path';
import { backtestModel } from '../lib/backtest.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const model = arg('model');
if (!model || model === true) {
  console.error('Usage: node scripts/backtest.js --model <openrouter-slug> [--label X] [--matches id,id | --all] [--store] [--out file]');
  process.exit(1);
}
const matchesArg = arg('matches');
const matchIds = matchesArg && matchesArg !== true ? String(matchesArg).split(',').map((s) => s.trim()) : null;
if (!matchIds && !process.argv.includes('--all')) {
  console.error('Pick matches with --matches id,id or pass --all for every resolved match.');
  process.exit(1);
}

const report = await backtestModel({
  model,
  label: arg('label', model) === true ? model : arg('label', model),
  matchIds,
  store: process.argv.includes('--store'),
  concurrency: Number(arg('concurrency', 3)) || 3,
});

const { summary } = report;
console.log(`\nBacktest: ${report.label} (${report.model})${report.demo ? ' [DEMO]' : ''}`);
console.log(report.note);
console.log('');
for (const r of report.matches) {
  if (r.error) {
    console.log(`  ${r.shortName}  FAILED: ${r.error}`);
    continue;
  }
  const probs = Object.entries(r.probs).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' / ');
  const vs = r.fieldMean != null
    ? `field mean ${r.fieldMean.toFixed(3)} → rank ${r.rankVsField}/${r.fieldSize + 1}`
    : 'no locked field';
  console.log(`  ${r.shortName} (${r.score}, ${r.outcome})  ${probs}  Brier ${r.brier.toFixed(3)}  |  ${vs}`);
  if (r.rationale) console.log(`    "${r.rationale}"`);
}
console.log('');
console.log(`  scored ${summary.scored}/${summary.requested}, avg Brier ${summary.avgBrier?.toFixed(3) ?? 'n/a'} (coin flip ${summary.avgBaseline?.toFixed(3) ?? 'n/a'})`);
if (summary.fieldAvgSameMatches != null) {
  console.log(`  locked field avg on same matches: ${summary.fieldAvgSameMatches.toFixed(3)}; would rank ${summary.wouldRank}/${summary.rosterSize + 1}`);
}
if (report.stored) console.log('  stored into ledger as retro+backtest records');

const slug = report.model.replace(/[^a-z0-9.-]+/gi, '_');
const out = arg('out', path.join('data', 'backtests', `${slug}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`  report: ${out}\n`);
if (!summary.scored) process.exit(1);
