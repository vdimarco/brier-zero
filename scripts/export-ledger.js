// Audit export: pull the database ledger into data/store.json so the
// git history remains the tamper-evident record of what was forecast
// when. Run periodically and commit the result.
import fs from 'node:fs';
import { dbEnabled, fetchLedger } from '../lib/db.js';

if (!dbEnabled()) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY first.');
  process.exit(1);
}
const ledger = await fetchLedger({ force: true });
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/store.json', JSON.stringify(ledger, null, 2));
const preds = Object.values(ledger.predictions).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`exported: ${preds} predictions, ${Object.keys(ledger.snapshots).length} snapshot matches, ${ledger.outright.length} outright rounds`);
