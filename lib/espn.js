// Fixtures and live scores from ESPN's public World Cup scoreboard feed.
// No API key required. Cached briefly so the UI can poll aggressively
// without hammering ESPN.

const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const CACHE_TTL_MS = 25 * 1000;
let cache = { at: 0, key: '', matches: null };

function yyyymmdd(d) {
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

// A match that finished in extra time or on penalties was, by definition, a
// draw after 90 minutes, which is the outcome the models are asked to price.
const BEYOND_REGULATION = new Set(['STATUS_FINAL_PEN', 'STATUS_FINAL_AET', 'STATUS_SHOOTOUT']);

export function regulationOutcome(match) {
  if (match.status.state !== 'post') return null;
  if (BEYOND_REGULATION.has(match.status.name)) return 'draw';
  if (match.home.shootoutScore != null || match.away.shootoutScore != null) return 'draw';
  const h = Number(match.home.score);
  const a = Number(match.away.score);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return h > a ? 'home' : a > h ? 'away' : 'draw';
}

function normalizeEvent(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const side = (homeAway) => {
    const c = comp.competitors?.find((x) => x.homeAway === homeAway);
    if (!c) return null;
    return {
      name: c.team?.displayName ?? c.team?.name ?? 'TBD',
      abbr: c.team?.abbreviation ?? '???',
      logo: c.team?.logo ?? null,
      score: c.score != null ? Number(c.score) : null,
      shootoutScore: c.shootoutScore != null ? Number(c.shootoutScore) : null,
      winner: c.winner === true,
    };
  };
  const home = side('home');
  const away = side('away');
  if (!home || !away) return null;
  const status = comp.status?.type ?? {};
  const match = {
    id: String(event.id),
    kickoff: event.date,
    name: event.name,
    shortName: event.shortName,
    stage: event.season?.slug?.replaceAll('-', ' ') ?? '',
    venue: comp.venue?.fullName ?? '',
    status: {
      state: status.state ?? 'pre', // pre | in | post
      name: status.name ?? '',
      detail: status.shortDetail ?? status.detail ?? '',
    },
    home,
    away,
  };
  match.outcome = regulationOutcome(match);
  return match;
}

// Window: a week back (recently scored games) through the tournament final.
function windowKey(now = new Date()) {
  const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const to = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return `${yyyymmdd(from)}-${yyyymmdd(to)}`;
}

export async function fetchMatches({ force = false } = {}) {
  const key = windowKey();
  const fresh = Date.now() - cache.at < CACHE_TTL_MS;
  if (!force && fresh && cache.key === key && cache.matches) return cache.matches;

  const res = await fetch(`${SCOREBOARD_URL}?dates=${key}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ESPN scoreboard HTTP ${res.status}`);
  const data = await res.json();
  const matches = (data.events ?? [])
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  cache = { at: Date.now(), key, matches };
  return matches;
}
