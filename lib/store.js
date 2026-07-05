// Tiny JSON-file store for predictions. Atomic writes (tmp + rename) so a
// crash mid-write never corrupts the record.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLED = path.join(root, 'data', 'store.json');
// On Vercel the repo is read-only: reads come from the committed ledger,
// writes land in /tmp (per-instance; durable collection happens elsewhere).
const DATA_DIR =
  process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/brier-zero-data' : path.join(root, 'data'));
const FILE = path.join(
  DATA_DIR,
  process.env.DEMO_MODE === '1' ? 'store.demo.json' : 'store.json'
);

let state = null;

function load() {
  if (state) return state;
  for (const file of [FILE, BUNDLED]) {
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      break;
    } catch {
      state = null;
    }
  }
  state ??= { predictions: {} };
  state.predictions ??= {};
  return state;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export function getPredictions() {
  return load().predictions;
}

// In-play snapshots: timestamped re-forecasts collected while a match is
// live. Exhibition only; they never touch the scored, locked forecasts.
export function getSnapshots() {
  const s = load();
  s.snapshots ??= {};
  return s.snapshots;
}

export function saveSnapshot(matchId, entry) {
  const s = load();
  s.snapshots ??= {};
  s.snapshots[matchId] ??= [];
  s.snapshots[matchId].push(entry);
  persist();
}

export function getPrediction(matchId, modelId) {
  return load().predictions[matchId]?.[modelId] ?? null;
}

export function savePrediction(matchId, modelId, record) {
  const s = load();
  s.predictions[matchId] ??= {};
  s.predictions[matchId][modelId] = record;
  persist();
}

export function storePath() {
  return FILE;
}
