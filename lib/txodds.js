// TxLINE (TXODDS) client: fixtures, StablePrice odds, and scores from the
// on-chain-anchored TxLINE API — https://txline-docs.txodds.com
//
// Auth model (two credentials on every call):
//   Authorization: Bearer <guest JWT>   — free, fetched/renewed automatically
//   X-Api-Token:   <activated token>    — from the one-time on-chain
//                                         subscribe + activate flow
//                                         (scripts/txodds-setup.mjs)
//
// The World Cup free tier needs zero TxL tokens; only the activated API
// token. Everything here is best-effort: if the token is absent or the API
// misbehaves, callers fall back to ESPN-only behaviour and the app keeps
// working.

const ENV = (process.env.TXODDS_ENV || 'mainnet').toLowerCase();
const ORIGIN =
  process.env.TXODDS_API_ORIGIN ||
  (ENV === 'devnet' ? 'https://txline-dev.txodds.com' : 'https://txline.txodds.com');
const API = `${ORIGIN}/api`;
const AUTH_URL = `${ORIGIN}/auth/guest/start`;

// FIFA World Cup competition id on the TxLINE feed (from the official
// devnet examples). Overridable in case the id differs per environment.
const COMPETITION_ID = Number(process.env.TXODDS_COMPETITION_ID || 72);

export function txoddsReady() {
  return Boolean(process.env.TXODDS_API_TOKEN);
}

export function txoddsStatus() {
  return {
    configured: txoddsReady(),
    env: ENV,
    origin: ORIGIN,
    competitionId: COMPETITION_ID,
  };
}

// ---------------------------------------------------------------- auth ----

let jwtCache = { token: null, at: 0 };
const JWT_TTL_MS = 30 * 60 * 1000; // renewed proactively; 401 also renews

async function guestJwt(force = false) {
  if (!force && jwtCache.token && Date.now() - jwtCache.at < JWT_TTL_MS) {
    return jwtCache.token;
  }
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TxLINE guest auth HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.token) throw new Error('TxLINE guest auth: no token in response');
  jwtCache = { token: body.token, at: Date.now() };
  return jwtCache.token;
}

async function apiGet(path, { retried = false } = {}) {
  const jwt = await guestJwt();
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Api-Token': process.env.TXODDS_API_TOKEN,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if ((res.status === 401 || res.status === 403) && !retried) {
    await guestJwt(true); // stale guest JWT: renew once and retry
    return apiGet(path, { retried: true });
  }
  if (!res.ok) throw new Error(`TxLINE ${path} HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------- payload utilities ----

// TxLINE messages arrive as envelopes ({ MessageId, Ts, ...payload }) and
// some fields are stringified JSON. unwrap() digs out every plain object a
// message contains, so field-hunting works whatever the nesting.
export function unwrap(msg, depth = 0) {
  if (depth > 4 || msg == null) return [];
  if (typeof msg === 'string') {
    const t = msg.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { return unwrap(JSON.parse(t), depth + 1); } catch { return []; }
    }
    return [];
  }
  if (Array.isArray(msg)) return msg.flatMap((x) => unwrap(x, depth + 1));
  if (typeof msg !== 'object') return [];
  const out = [msg];
  for (const v of Object.values(msg)) {
    if (v && (typeof v === 'object' || typeof v === 'string')) {
      out.push(...unwrap(v, depth + 1));
    }
  }
  return out;
}

const lower = (o) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------ team names ----

// TxLINE uses FIFA-style names, ESPN uses common names. Normalize both ends
// so "Korea Republic" meets "South Korea" in the middle.
const ALIASES = new Map(
  Object.entries({
    'korea republic': 'south korea',
    'korea dpr': 'north korea',
    'ir iran': 'iran',
    usa: 'united states',
    'united states of america': 'united states',
    'cote d ivoire': 'ivory coast', // apostrophes normalize to spaces
    'cote divoire': 'ivory coast',
    turkiye: 'turkey',
    'china pr': 'china',
    czechia: 'czech republic',
    'bosnia herzegovina': 'bosnia and herzegovina',
    'republic of ireland': 'ireland',
    'trinidad tobago': 'trinidad and tobago',
    'saudi': 'saudi arabia',
  })
);

export function normTeam(name) {
  if (!name) return '';
  let s = String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES.get(s) ?? s;
}

// ---------------------------------------------------------------- fixtures ----

const EPOCH_DAY_MS = 24 * 3600 * 1000;
const epochDay = (d = new Date()) => Math.floor(d.getTime() / EPOCH_DAY_MS);

let fixturesCache = { at: 0, list: null };
const FIXTURES_TTL_MS = 5 * 60 * 1000;

// One TxLINE fixture, reduced to what matching and display need. Field
// names hunt across the plausible spellings ({FixtureId|fixtureId|id}, …)
// because the envelope schema is only fully visible with a live token.
export function normalizeFixture(raw) {
  const candidates = unwrap(raw).map(lower);
  for (const o of candidates) {
    const id = o.fixtureid ?? o.fixture_id ?? o.id ?? null;
    const p1 =
      o.participant1 ?? o.participant1name ?? o.hometeam ?? o.home ?? null;
    const p2 =
      o.participant2 ?? o.participant2name ?? o.awayteam ?? o.away ?? null;
    if (id == null || !p1 || !p2) continue;
    const p1Name = typeof p1 === 'object' ? p1.name ?? p1.Name : p1;
    const p2Name = typeof p2 === 'object' ? p2.name ?? p2.Name : p2;
    if (typeof p1Name !== 'string' || typeof p2Name !== 'string') continue;
    // Participant1IsHome tells us the feed's home/away mapping (it is NOT
    // implied by participant order). Default true when absent.
    const p1Home = o.participant1ishome ?? o.p1ishome ?? true;
    const kickoff =
      o.startdate ?? o.starttime ?? o.kickoff ?? o.date ?? o.ts ?? null;
    return {
      fixtureId: String(id),
      home: p1Home !== false ? p1Name : p2Name,
      away: p1Home !== false ? p2Name : p1Name,
      kickoff: kickoff ? new Date(isNaN(kickoff) ? kickoff : Number(kickoff) * (Number(kickoff) < 1e12 ? 1000 : 1)).toISOString() : null,
      raw,
    };
  }
  return null;
}

export async function fetchFixtures({ force = false } = {}) {
  if (!force && fixturesCache.list && Date.now() - fixturesCache.at < FIXTURES_TTL_MS) {
    return fixturesCache.list;
  }
  // Window: from a week back so recently finished fixtures stay matchable.
  const start = epochDay(new Date(Date.now() - 7 * EPOCH_DAY_MS));
  const data = await apiGet(
    `/fixtures/snapshot?competitionId=${COMPETITION_ID}&startEpochDay=${start}`
  );
  const rows = Array.isArray(data) ? data : data?.fixtures ?? data?.data ?? [];
  const list = (Array.isArray(rows) ? rows : []).map(normalizeFixture).filter(Boolean);
  fixturesCache = { at: Date.now(), list };
  return list;
}

// Match an ESPN match to a TxLINE fixture: same (normalized) team pair,
// kickoff within six hours. Either orientation matches; orientation is
// remembered so odds map to the right sides.
export function matchFixture(espnMatch, fixtures) {
  const h = normTeam(espnMatch.home.name);
  const a = normTeam(espnMatch.away.name);
  if (!h || !a) return null;
  const ko = new Date(espnMatch.kickoff).getTime();
  let best = null;
  for (const f of fixtures) {
    const fh = normTeam(f.home);
    const fa = normTeam(f.away);
    let flipped;
    if (fh === h && fa === a) flipped = false;
    else if (fh === a && fa === h) flipped = true;
    else continue;
    const dt = f.kickoff ? Math.abs(new Date(f.kickoff).getTime() - ko) : 0;
    if (dt > 6 * 3600 * 1000) continue;
    if (!best || dt < best.dt) best = { fixture: f, flipped, dt };
  }
  return best;
}

// ------------------------------------------------------------------ odds ----

let oddsCache = new Map(); // fixtureId -> { at, value }
const ODDS_TTL_MS = 30 * 1000;

// A price value from TxLINE's `Prices` array is either decimal odds
// (>1, e.g. 2.888) or that same value in thousandths (>1000, e.g. 2888).
// Scale it down to decimal odds; leave already-decimal values alone.
function scalePrice(v) {
  const n = num(v);
  if (n == null) return null;
  return n > 1000 ? n / 1000 : n;
}

function keyToSide(rawKey) {
  const key = String(rawKey ?? '').toLowerCase().trim();
  if (key === 'home' || key === '1' || key === 'p1' || key === 'part1') return 'home';
  if (key === 'draw' || key === 'x') return 'draw';
  if (key === 'away' || key === '2' || key === 'p2' || key === 'part2') return 'away';
  return null;
}

// Hunt decimal 1X2 prices out of an odds message. Handles the shapes the
// docs and examples hint at: named fields (home/draw/away, price1/x/2),
// outcome arrays, TXODDS "1 X 2"-keyed maps, and TxLINE's real parallel
// PriceNames/Prices arrays (values in thousandths). Returns decimal odds.
export function extractPrices(msg) {
  const objs = unwrap(msg).map(lower);
  for (const o of objs) {
    // Named triples, most explicit first.
    const trios = [
      [o.homeprice, o.drawprice, o.awayprice],
      [o.price1, o.pricex, o.price2],
      [o.p1, o.px, o.p2],
      [o.home, o.draw, o.away],
      [o['1'], o.x, o['2']],
    ];
    for (const [h, d, a] of trios) {
      const [hn, dn, an] = [num(h), num(d), num(a)];
      if (hn > 1 && dn > 1 && an > 1) return { home: hn, draw: dn, away: an };
    }
    // Outcome arrays: [{outcome|name|type: "home"|"1", price|odds: 2.1}, …]
    const arr = o.outcomes ?? o.prices ?? o.selections ?? o.odds;
    if (Array.isArray(arr)) {
      const found = {};
      for (const item of arr) {
        if (item == null || typeof item !== 'object') continue;
        const it = lower(item);
        const key = String(it.outcome ?? it.name ?? it.type ?? it.side ?? '')
          .toLowerCase().trim();
        const price = num(it.price ?? it.odds ?? it.value ?? it.decimal);
        if (!(price > 1)) continue;
        if (key === 'home' || key === '1' || key === 'p1') found.home = price;
        else if (key === 'draw' || key === 'x') found.draw = price;
        else if (key === 'away' || key === '2' || key === 'p2') found.away = price;
      }
      if (found.home > 1 && found.draw > 1 && found.away > 1) return found;
    }
    // TxLINE real shape: parallel keys/values arrays, e.g.
    // PriceNames: ["part1","draw","part2"], Prices: [2888,2214,4951]
    // (thousandths of decimal odds).
    const names = o.pricenames ?? o.names ?? o.keys;
    const values = o.prices;
    if (Array.isArray(names) && Array.isArray(values) && names.length === values.length) {
      const found = {};
      for (let i = 0; i < names.length; i++) {
        const side = keyToSide(names[i]);
        if (!side) continue;
        const price = scalePrice(values[i]);
        if (price > 1) found[side] = price;
      }
      if (found.home > 1 && found.draw > 1 && found.away > 1) return found;
    }
  }
  return null;
}

// True for TxLINE messages carrying the full-match (not per-period) 1X2
// consensus price: SuperOddsType is the 1X2 result market and MarketPeriod
// is null/absent/empty (period-qualified messages, e.g. "half=1", cover a
// different market and must not be used as the full-match line).
export function isFullTimeMatchOdds(msg) {
  const o = lower(msg && typeof msg === 'object' ? msg : {});
  const type = String(o.superoddstype ?? '').toLowerCase();
  if (type !== '1x2_participant_result') return false;
  const period = o.marketperiod;
  return period == null || String(period).trim() === '';
}

// Decimal odds -> implied probabilities with the vig stripped
// (proportional / normalization method): p_i = (1/o_i) / sum(1/o_j).
export function impliedProbs(prices) {
  const inv = {
    home: 1 / prices.home,
    draw: 1 / prices.draw,
    away: 1 / prices.away,
  };
  const overround = inv.home + inv.draw + inv.away;
  if (!(overround > 0)) return null;
  return {
    probs: {
      home: inv.home / overround,
      draw: inv.draw / overround,
      away: inv.away / overround,
    },
    overround,
  };
}

// Knockout "who advances" from 90-minute 1X2 probabilities. Without a
// to-qualify offer we split the draw by relative strength: a draw sends
// the tie to extra time / penalties, where the stronger side on the day is
// modestly favoured. Transparent, tested, and clearly labelled.
export function advanceProbs(reg) {
  const strength = reg.home + reg.away;
  const homeShare = strength > 0 ? reg.home / strength : 0.5;
  const home = reg.home + reg.draw * homeShare;
  const away = reg.away + reg.draw * (1 - homeShare);
  const sum = home + away;
  return { home: home / sum, away: away / sum };
}

export async function fetchOddsSnapshot(fixtureId, { force = false, asOf = null } = {}) {
  const cacheKey = asOf ? `${fixtureId}@${asOf}` : fixtureId;
  const hit = oddsCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < (asOf ? 3600_000 : ODDS_TTL_MS)) return hit.value;
  // asOf: historical line at a moment in time (epoch milliseconds), used
  // to backfill the market's pre-kickoff view of an already-played
  // fixture. The API requires milliseconds, not seconds.
  const asOfMs = asOf ? new Date(asOf).getTime() : null;
  const data = await apiGet(
    `/odds/snapshot/${fixtureId}${asOfMs ? `?asOf=${asOfMs}` : ''}`
  );
  const msgs = Array.isArray(data) ? data : data?.data ?? [data];
  // Newest message with usable prices wins (envelopes carry a Ts field).
  // Only the full-match 1X2 consensus qualifies; prefer the stable-price
  // bookmaker (10021) when present, falling back to any qualifying 1X2
  // bookmaker otherwise.
  const qualifying = msgs.filter((m) => isFullTimeMatchOdds(m));
  const preferred = qualifying.filter(
    (m) => num(lower(m && typeof m === 'object' ? m : {}).bookmakerid) === 10021
  );
  const pool = preferred.length ? preferred : qualifying;
  const withTs = pool
    .map((m) => ({ m, ts: num(lower(m && typeof m === 'object' ? m : {}).ts) ?? 0 }))
    .sort((x, y) => y.ts - x.ts);
  let value = null;
  for (const { m } of withTs) {
    const prices = extractPrices(m);
    if (prices) {
      value = { prices, at: new Date().toISOString() };
      break;
    }
  }
  oddsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// ----------------------------------------------------------------- scores ----

export async function fetchScoresSnapshot(fixtureId) {
  return apiGet(`/scores/snapshot/${fixtureId}`);
}

// --------------------------------------------- the market, as a forecaster ----

// The full pipeline: ESPN match -> TxLINE fixture -> StablePrice odds ->
// de-vigged probabilities in the match's market. Returns null (never
// throws) when any link is missing, so collection simply retries later.
export async function marketProbs(match, { asOf = null } = {}) {
  try {
    const fixtures = await fetchFixtures();
    const found = matchFixture(match, fixtures);
    if (!found) return null;
    const snap = await fetchOddsSnapshot(found.fixture.fixtureId, { asOf });
    if (!snap?.prices) return null;
    let { prices } = snap;
    if (found.flipped) {
      prices = { home: prices.away, draw: prices.draw, away: prices.home };
    }
    const implied = impliedProbs(prices);
    if (!implied) return null;
    const market = match.market ?? 'regulation';
    const probs = market === 'advance' ? advanceProbs(implied.probs) : implied.probs;
    const vigPct = ((implied.overround - 1) * 100).toFixed(1);
    const rationale =
      market === 'advance'
        ? `TxODDS StablePrice consensus (1X2 ${prices.home}/${prices.draw}/${prices.away}, ${vigPct}% vig removed), draw split by relative strength for the advance market.`
        : `TxODDS StablePrice consensus: decimal ${prices.home}/${prices.draw}/${prices.away}, ${vigPct}% vig removed.`;
    return {
      probs,
      rationale,
      odds: {
        fixtureId: found.fixture.fixtureId,
        prices,
        overround: implied.overround,
        source: 'txodds-stableprice',
        env: ENV,
      },
    };
  } catch (err) {
    console.error('[txodds] marketProbs failed:', err.message);
    return null;
  }
}

// Attach the market's current view to matches for display (never throws;
// bounded to fixtures that are upcoming or live so a poll stays cheap).
export async function attachMarketOdds(matches) {
  if (!txoddsReady()) return matches;
  let fixtures;
  try {
    fixtures = await fetchFixtures();
  } catch (err) {
    console.error('[txodds] fixtures unavailable:', err.message);
    return matches;
  }
  const active = matches.filter(
    (m) => m.status.state !== 'post' && !m.teamsTbd
  ).slice(0, 24);
  await Promise.allSettled(
    active.map(async (m) => {
      const found = matchFixture(m, fixtures);
      if (!found) return;
      const snap = await fetchOddsSnapshot(found.fixture.fixtureId);
      if (!snap?.prices) return;
      const prices = found.flipped
        ? { home: snap.prices.away, draw: snap.prices.draw, away: snap.prices.home }
        : snap.prices;
      const implied = impliedProbs(prices);
      if (!implied) return;
      m.marketOdds = {
        prices,
        probs:
          (m.market ?? 'regulation') === 'advance'
            ? advanceProbs(implied.probs)
            : implied.probs,
        overround: implied.overround,
        at: snap.at,
        fixtureId: found.fixture.fixtureId,
      };
    })
  );
  return matches;
}
