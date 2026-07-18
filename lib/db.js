// Supabase (PostgREST) client for the forecast ledger. Plain fetch, no
// SDK. Reads use the anon key (the ledger is public); writes go through
// token-gated SECURITY DEFINER functions, so the anon key alone cannot
// ingest. Active when SUPABASE_URL and SUPABASE_ANON_KEY are set.

const URL_ = () => process.env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_ANON_KEY;
const TOKEN = () => process.env.INGEST_TOKEN;

export function dbEnabled() {
  return Boolean(URL_() && KEY());
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY(),
      Authorization: `Bearer ${KEY()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`supabase ${method} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// The whole ledger in the exact in-memory shape the file store uses.
// Cached briefly so a burst of /api/state calls costs one round trip.
let cache = { at: 0, data: null };
const CACHE_MS = 10 * 1000;

export async function fetchLedger({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [preds, snaps, outs] = await Promise.all([
    rest('predictions?select=match_id,model_id,data'),
    rest('snapshots?select=match_id,entry&order=at.asc'),
    rest('outright?select=entry&order=at.asc'),
  ]);
  const data = { predictions: {}, snapshots: {}, outright: [] };
  for (const r of preds) (data.predictions[r.match_id] ??= {})[r.model_id] = r.data;
  for (const r of snaps) (data.snapshots[r.match_id] ??= []).push(r.entry);
  for (const r of outs) data.outright.push(r.entry);
  cache = { at: Date.now(), data };
  return data;
}

export function invalidateLedgerCache() {
  cache = { at: 0, data: null };
}

const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: { tok: TOKEN(), ...args } });

export async function dbSavePrediction(matchId, modelId, record) {
  await rpc('ingest_prediction', { p_match: matchId, p_model: modelId, p_data: record });
  invalidateLedgerCache();
}

export async function dbSaveSnapshot(matchId, entry) {
  await rpc('ingest_snapshot', { p_match: matchId, p_entry: entry });
  invalidateLedgerCache();
}

export async function dbSaveOutright(entry) {
  await rpc('ingest_outright', { p_entry: entry });
  invalidateLedgerCache();
}

// True when this caller holds the named lock for the next `seconds`.
export async function dbTryLock(name, seconds) {
  return (await rpc('try_lock', { p_name: name, p_seconds: seconds })) === true;
}
