// CLI: compute The Bankroll (paper-trading ledger) over the real tournament
// ledger and print the table. Deterministic: run it twice, diff the JSON —
// byte-identical (no timestamps in the output on purpose).
//
//   node scripts/bankroll.js [--out data/backtests/bankroll.json]

import fs from 'node:fs';
import path from 'node:path';
import { fetchMatches } from '../lib/espn.js';
import { getPredictions } from '../lib/store.js';
import { loadEntrants } from '../lib/predictor.js';
import { computeBankrolls } from '../lib/bankroll.js';

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx !== -1 ? process.argv[outIdx + 1] : 'data/backtests/bankroll.json';

const matches = await fetchMatches();
const predictions = await getPredictions();
const entrants = loadEntrants();
const report = computeBankrolls(matches, predictions, entrants);

const label = (id) => entrants.find((e) => e.id === id)?.label ?? id;
const rows = Object.values(report.models).sort((a, b) => b.bankroll - a.bankroll);
console.log(`The Bankroll — ${report.startingBankroll} units at start, quarter-Kelly vs the TxODDS line\n`);
for (const r of rows) {
  const hit = r.betsPlaced ? `${r.wins}/${r.betsPlaced}` : '—';
  console.log(
    `  ${String(r.bankroll).padStart(8)}  ${label(r.model).padEnd(18)} bets ${String(r.betsPlaced).padStart(3)}  hit ${hit.padStart(7)}  no-bet ${String(r.noBets).padStart(3)}` +
    (r.biggestWin ? `  best +${r.biggestWin.pnl} (${r.biggestWin.shortName})` : '')
  );
}
const totalBets = report.bets.filter((b) => b.result !== 'no_bet').length;
console.log(`\n  ${totalBets} bets settled, ${report.bets.length - totalBets} no-bets, across ${new Set(report.bets.map((b) => b.matchId)).size} matches`);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
console.log(`  report written to ${outFile}`);
