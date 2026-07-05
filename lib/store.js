// Tiny JSON-file store for predictions. Atomic writes (tmp + rename) so a
// crash mid-write never corrupts the record.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const FILE = path.join(
  DATA_DIR,
  process.env.DEMO_MODE === '1' ? 'store.demo.json' : 'store.json'
);

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = { predictions: {} };
  }
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
