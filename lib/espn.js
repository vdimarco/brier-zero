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
// draw after 90 minutes, which is the group-stage outcome models price.
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

// Knockout matches are priced as a two-way market: who advances (wins the
// tie, whether in 90 minutes, extra time, or on penalties). ESPN slugs:
// round-of-32, round-of-16, quarterfinals, semifinals, final. An unknown
// or missing stage falls back to the regulation market, never the reverse.
const KNOCKOUT_STAGE = /round of|quarter|semi|final|third/i;

export function marketOf(match) {
  return KNOCKOUT_STAGE.test(match.stage ?? '') ? 'advance' : 'regulation';
}

// Who went through. ESPN flags the advancing competitor with winner: true;
// fall back to shootout score, then match score, for older records.
export function advanceOutcome(match) {
  if (match.status.state !== 'post') return null;
  if (match.home.winner !== match.away.winner) return match.home.winner ? 'home' : 'away';
  const so = Number(match.home.shootoutScore) - Number(match.away.shootoutScore);
  if (Number.isFinite(so) && so !== 0) return so > 0 ? 'home' : 'away';
  const goals = Number(match.home.score) - Number(match.away.score);
  if (Number.isFinite(goals) && goals !== 0) return goals > 0 ? 'home' : 'away';
  return null;
}

function normalizeEvent(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const side = (homeAway) => {
    const c = comp.competitors?.find((x) => x.homeAway === homeAway);
    if (!c) return null;
    return {
      teamId: c.team?.id ?? null,
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
  // Key events (goals, red cards) feed the in-play forecast prompt.
  match.keyEvents = (comp.details ?? [])
    .filter((d) => d.scoringPlay || d.redCard)
    .map((d) => {
      const teamName =
        d.team?.id === home.teamId ? home.name : d.team?.id === away.teamId ? away.name : '';
      const who = d.athletesInvolved?.[0]?.displayName ?? '';
      const what = d.redCard
        ? 'Red card'
        : `Goal${d.ownGoal ? ' (own goal)' : d.penaltyKick ? ' (penalty)' : ''}`;
      return `${d.clock?.displayValue ?? ''} ${what}${who ? ` - ${who}` : ''}${teamName ? ` (${teamName})` : ''}`.trim();
    });
  // Which market this fixture trades in, plus the settlement for BOTH
  // markets: legacy 90-minute forecasts on knockout matches still need
  // their own settlement even though the match now prices advancement.
  match.market = marketOf(match);
  match.outcomes = {
    regulation: regulationOutcome(match),
    advance: match.market === 'advance' ? advanceOutcome(match) : null,
  };
  match.outcome = match.outcomes[match.market];
  // Bracket placeholders ("Quarterfinal 1 Winner") have no country logo.
  // Forecasting them would price unknown teams, so they are held back.
  match.teamsTbd = !home.logo || !away.logo;
  return match;
}

// Window: the whole tournament, so scoring never loses old matches.
// Display filtering happens downstream.
const TOURNAMENT_START = '20260611';
function windowKey(now = new Date()) {
  const to = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return `${TOURNAMENT_START}-${yyyymmdd(to)}`;
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
