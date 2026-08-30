// Forecast ledger store. Two backends behind one async API:
//  - Supabase (SUPABASE_URL + SUPABASE_ANON_KEY set): the live backend;
//    reads come straight from the database, writes go through the
//    token-gated ingest functions.
//  - JSON file (default): local runs, demo mode, and the git audit
//    export. Atomic writes (tmp + rename).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dbEnabled, fetchLedger, dbSavePrediction, dbSaveSnapshot, dbSaveOutright,
} from './db.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLED = path.join(root, 'data', 'store.json');
// On Vercel without a database the repo is read-only: reads come from the
// committed ledger, writes land in /tmp (per-instance, ephemeral).
const DATA_DIR =
  process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/brier-zero-data' : path.join(root, 'data'));
const FILE = path.join(
  DATA_DIR,
  process.env.DEMO_MODE === '1' ? 'store.demo.json' : 'store.json'
);

let state = null;

function loadFile() {
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
  state.snapshots ??= {};
  state.outright ??= [];
  state.proofs ??= {};
  state.questions ??= {};
  return state;
}

function persistFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export async function getLedger() {
  return dbEnabled() ? fetchLedger() : loadFile();
}

export async function getPredictions() {
  return (await getLedger()).predictions;
}

export async function getPrediction(matchId, modelId) {
  return (await getLedger()).predictions[matchId]?.[modelId] ?? null;
}

export async function savePrediction(matchId, modelId, record) {
  if (dbEnabled()) return dbSavePrediction(matchId, modelId, record);
  const s = loadFile();
  s.predictions[matchId] ??= {};
  s.predictions[matchId][modelId] = record;
  persistFile();
}

// In-play snapshots: timestamped re-forecasts collected while a match is
// live. Exhibition only; they never touch the scored, locked forecasts.
export async function getSnapshots() {
  return (await getLedger()).snapshots;
}

export async function saveSnapshot(matchId, entry) {
  if (dbEnabled()) return dbSaveSnapshot(matchId, entry);
  const s = loadFile();
  s.snapshots[matchId] ??= [];
  s.snapshots[matchId].push(entry);
  persistFile();
}

// Outright winner forecasts: a time series of "who lifts the trophy"
// rounds, each holding every model's probability per remaining team.
export async function getOutright() {
  return (await getLedger()).outright;
}

export async function saveOutright(entry) {
  if (dbEnabled()) return dbSaveOutright(entry);
  const s = loadFile();
  s.outright.push(entry);
  persistFile();
}

// ---- the perpetual record ---------------------------------------------
// Questions from a live prediction market, their locked forecasts, and their
// settled outcomes. Deliberately file-backed only, with no Supabase path:
// the whole value of this bucket is that the git history proves each forecast
// predates its resolution. A database write is not a timestamp anyone can
// check; a commit is. scripts/collect-questions.js commits after every run.
export async function getQuestions() {
  return (await getLedger()).questions ?? {};
}

export async function saveQuestion(question) {
  const s = loadFile();
  s.questions ??= {};
  const prior = s.questions[question.id];
  // The question text is a commitment too: once asked, never rewritten. Only
  // the volatile fields (price, status, outcome) move.
  s.questions[question.id] = prior
    ? { ...prior, price: question.price, spread: question.spread, status: question.status }
    : { ...question, askedAt: new Date().toISOString(), forecasts: {} };
  persistFile();
  return s.questions[question.id];
}

export async function saveQuestionForecast(questionId, modelId, record) {
  const s = loadFile();
  s.questions ??= {};
  const q = s.questions[questionId];
  if (!q) throw new Error(`unknown question ${questionId}`);
  q.forecasts ??= {};
  // A forecast is a commitment. Never overwrite a successful one.
  if (q.forecasts[modelId]?.probs) return false;
  q.forecasts[modelId] = record;
  persistFile();
  return true;
}

export async function settleQuestion(questionId, outcome, at = new Date().toISOString()) {
  const s = loadFile();
  const q = s.questions?.[questionId];
  if (!q || q.outcome) return false;
  q.outcome = outcome;
  q.settledAt = at;
  persistFile();
  return true;
}

export function storePath() {
  return FILE;
}

// On-chain score-proof verification results, keyed by ESPN match id.
// Derived, re-runnable data (scripts/verify-results.js repopulates it) so
// this bucket stays file-local regardless of the Supabase backend.
export async function getProofs() {
  return loadFile().proofs;
}

export async function saveProof(matchId, proof) {
  const s = loadFile();
  s.proofs[matchId] = proof;
  persistFile();
}
