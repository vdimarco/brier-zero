// Kalshi adapter: the perpetual question source.
//
// The World Cup gave this repo 104 questions and then ended. A prediction
// market never ends: contracts open and settle continuously, each one a
// resolvable claim that arrives with a price attached. That price is what
// makes it worth scoring against — the same role TxODDS StablePrice played
// for the football season, and the reason a leaderboard here answers "is
// this model good enough to bet" rather than "is this model accurate".
//
// Binary contracts settle at 100¢ if the claim holds and 0¢ if it doesn't,
// so a price in cents *is* an implied probability. No de-vigging needed:
// the bid/ask spread is the cost of crossing, and we keep both numbers.
//   - midpoint  -> The Market's forecast, Brier-scored like any entrant
//   - the ask   -> what a bet actually costs, so the bankroll is honest
//
// Market data on Kalshi is public and needs no key; only trading does. This
// file therefore has no credentials in it. Everything above fetch() is a
// pure function over a raw market object so it can be tested from fixtures
// without a network — see test/kalshi.test.js.

const API = process.env.KALSHI_API || 'https://api.elections.kalshi.com/trade-api/v2';

// Field names below follow Kalshi's documented market object. They have NOT
// been checked against a live response from this machine (outbound HTTPS to
// api.elections.kalshi.com is blocked here). Run scripts/kalshi-probe.mjs
// from a networked shell once before trusting the cron; it prints the raw
// shape and flags any field this file expects and does not find.

const CENTS = 100;

// A Kalshi price is an integer 1..99 cents on a contract that settles at 100.
// Anything outside that band is a market with no real two-sided quote.
export function centsToProb(cents) {
  const c = Number(cents);
  if (!Number.isFinite(c) || c <= 0 || c >= CENTS) return null;
  return c / CENTS;
}

// The market's own forecast: the midpoint of the two-sided quote.
// This is the entrant that competes on the leaderboard.
export function marketProbs(raw) {
  const bid = Number(raw?.yes_bid);
  const ask = Number(raw?.yes_ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  const yes = centsToProb((bid + ask) / 2);
  if (yes === null) return null;
  return { yes, no: 1 - yes };
}

// How wide the book is, in probability. A 40¢/60¢ quote is a 0.20 spread and
// says the market does not have an opinion worth scoring.
export function spread(raw) {
  const bid = Number(raw?.yes_bid);
  const ask = Number(raw?.yes_ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return (ask - bid) / CENTS;
}

// What a bet costs, paying the ask. A contract bought at p cents returns 100,
// so decimal odds are 100/p — the spread stays in, exactly as the football
// bankroll settled at raw vigged odds rather than the de-vigged line.
export function executableOdds(raw, side) {
  const cents = side === 'yes' ? Number(raw?.yes_ask) : Number(raw?.no_ask);
  if (!Number.isFinite(cents) || cents <= 0 || cents >= CENTS) return null;
  return CENTS / cents;
}

// Settled markets carry their result. Anything not yet settled scores nothing.
export function settledOutcome(raw) {
  if (raw?.status !== 'settled' && raw?.status !== 'finalized') return null;
  const r = String(raw?.result ?? '').toLowerCase();
  return r === 'yes' || r === 'no' ? r : null;
}

const iso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// The generic question record. Deliberately carries no Kalshi-specific field
// past this boundary: a second venue becomes a second normalize function, not
// a second scoring path.
export function normalizeMarket(raw) {
  const id = raw?.ticker;
  const title = raw?.title;
  if (typeof id !== 'string' || !id || typeof title !== 'string' || !title) return null;
  const closeAt = iso(raw?.close_time);
  if (!closeAt) return null;
  return {
    id,
    venue: 'kalshi',
    event: raw?.event_ticker ?? null,
    title,
    subtitle: raw?.subtitle || raw?.yes_sub_title || null,
    rules: raw?.rules_primary || null,
    closeAt,
    openAt: iso(raw?.open_time),
    status: raw?.status ?? null,
    market: 'binary',
    volume: Number(raw?.volume) || 0,
    openInterest: Number(raw?.open_interest) || 0,
    price: marketProbs(raw),
    spread: spread(raw),
    outcome: settledOutcome(raw),
  };
}

// Which questions are worth entering. Every threshold here is a judgement
// that shapes the record for years, so they are named and defaulted in one
// place rather than scattered through the collector.
export const ELIGIBILITY = {
  minHoursToClose: 24,    // no forecasting something that closes tonight
  maxDaysToClose: 120,    // no forecasting the far future either
  maxSpread: 0.10,        // a wider book has no opinion worth scoring
  minVolume: 100,         // thin markets are noise, not a baseline
};

export function isEligible(raw, opts = {}) {
  const o = { ...ELIGIBILITY, ...opts };
  const now = o.now ? new Date(o.now) : new Date();
  const q = normalizeMarket(raw);
  if (!q) return false;
  if (q.status !== 'open') return false;
  if (!q.price) return false;
  if (q.spread === null || q.spread > o.maxSpread) return false;
  if (q.volume < o.minVolume) return false;
  const hours = (new Date(q.closeAt).getTime() - now.getTime()) / 3600000;
  if (!Number.isFinite(hours)) return false;
  return hours >= o.minHoursToClose && hours <= o.maxDaysToClose * 24;
}

// Deterministic pick so two runs over the same market list agree, and so a
// re-run after a crash re-selects the same questions rather than drifting.
// Sorted by liquidity, then ticker to break ties.
export function selectQuestions(rawMarkets, limit, opts = {}) {
  return (rawMarkets ?? [])
    .filter((m) => isEligible(m, opts))
    .map(normalizeMarket)
    .sort((a, b) => b.volume - a.volume || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// ---- network ----------------------------------------------------------

const TTL_MS = 60 * 1000;
let cache = { at: 0, markets: null };

async function get(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`kalshi ${path} ${res.status}`);
  return res.json();
}

// Pages until the cursor runs out or `max` markets are collected. Kalshi
// caps limit at 1000 per page.
export async function fetchOpenMarkets({ force = false, max = 1000, status = 'open' } = {}) {
  if (!force && cache.markets && Date.now() - cache.at < TTL_MS) return cache.markets;
  const out = [];
  let cursor;
  do {
    const page = await get('/markets', { limit: Math.min(1000, max - out.length), status, cursor });
    const batch = page?.markets ?? [];
    out.push(...batch);
    cursor = page?.cursor || null;
    if (!batch.length) break;
  } while (cursor && out.length < max);
  cache = { at: Date.now(), markets: out };
  return out;
}

export async function fetchMarket(ticker) {
  const r = await get(`/markets/${encodeURIComponent(ticker)}`);
  return r?.market ?? null;
}

// Settlement pass: given tickers we hold forecasts for, return the ones that
// have resolved, as { ticker: 'yes' | 'no' }.
export async function fetchOutcomes(tickers) {
  const out = {};
  for (const t of tickers) {
    try {
      const outcome = settledOutcome(await fetchMarket(t));
      if (outcome) out[t] = outcome;
    } catch {
      // A single unreachable ticker must not abort the settlement run.
    }
  }
  return out;
}

export function kalshiStatus() {
  return { api: API, cached: cache.markets?.length ?? 0, cachedAt: cache.at || null };
}
