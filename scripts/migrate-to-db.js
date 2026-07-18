// One-time migration: push the file ledger (data/store.json) into the
// database. Requires SUPABASE_URL, SUPABASE_ANON_KEY, INGEST_TOKEN.
// Safe to re-run: committed forecasts are never overwritten server-side.
import fs from 'node:fs';
import { dbEnabled, dbSavePrediction, dbSaveSnapshot, dbSaveOutright, fetchLedger } from '../lib/db.js';

if (!dbEnabled() || !process.env.INGEST_TOKEN) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, and INGEST_TOKEN first.');
  process.exit(1);
}
const file = JSON.parse(fs.readFileSync('data/store.json', 'utf8'));
const existing = await fetchLedger({ force: true });

let preds = 0;
for (const [matchId, byModel] of Object.entries(file.predictions ?? {})) {
  for (const [modelId, record] of Object.entries(byModel)) {
    if (existing.predictions[matchId]?.[modelId]?.probs) continue;
    await dbSavePrediction(matchId, modelId, record);
    preds++;
  }
}
let snaps = 0;
const have = new Set(
  Object.entries(existing.snapshots).flatMap(([id, list]) => list.map((e) => `${id}|${e.at}`))
);
for (const [matchId, list] of Object.entries(file.snapshots ?? {})) {
  for (const entry of list) {
    if (have.has(`${matchId}|${entry.at}`)) continue;
    await dbSaveSnapshot(matchId, entry);
    snaps++;
  }
}
let outs = 0;
const haveOut = new Set(existing.outright.map((e) => e.at));
for (const entry of file.outright ?? []) {
  if (haveOut.has(entry.at)) continue;
  await dbSaveOutright(entry);
  outs++;
}
console.log(`migrated: ${preds} predictions, ${snaps} snapshots, ${outs} outright rounds`);
