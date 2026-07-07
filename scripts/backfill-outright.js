// One-time backfill: retroactive tournament-winner forecasts anchored to
// the start of the round of 32 and the round of 16, so the trophy race
// chart has history dating back to the beginning of the knockouts
// instead of only the last day or two of live collection. Every model's
// training data predates this tournament, so these are unknowable-in-
// advance forecasts, same as the retro match backfill; entries are
// stamped retro: true.
import { fetchMatches } from '../lib/espn.js';
import { collectOutright, predictorReady } from '../lib/predictor.js';
import { getOutright } from '../lib/store.js';

if (!predictorReady()) {
  console.error('Set OPENROUTER_API_KEY (or DEMO_MODE=1) first.');
  process.exit(1);
}

const matches = await fetchMatches();
const byStage = (name) => matches.filter((m) => m.stage === name);
const teamsOf = (list) => [...new Set(list.flatMap((m) => [m.home.name, m.away.name]))];
const earliestKickoff = (list) =>
  list.reduce((a, m) => (new Date(m.kickoff) < new Date(a.kickoff) ? m : a)).kickoff;

const rounds = [
  { label: 'R32 start', stage: 'round of 32' },
  { label: 'R16 start', stage: 'round of 16' },
].map((r) => {
  const fixtures = byStage(r.stage);
  if (!fixtures.length) return null;
  const teams = teamsOf(fixtures);
  if (teams.length < 2) return null;
  const at = new Date(new Date(earliestKickoff(fixtures)).getTime() - 3600_000).toISOString();
  return { ...r, teams, at };
}).filter(Boolean);

if (!rounds.length) {
  console.log('No round of 32 / round of 16 fixtures found; nothing to backfill.');
  process.exit(0);
}

const history = await getOutright();
const already = new Set(history.map((e) => e.label).filter(Boolean));

for (const r of rounds) {
  if (already.has(r.label)) {
    console.log(`${r.label}: already backfilled, skipping.`);
    continue;
  }
  console.log(`${r.label}: collecting outright forecasts for ${r.teams.length} teams (dated ${r.at})...`);
  const result = await collectOutright(r.teams, undefined, { at: r.at, retro: true, label: r.label });
  console.log(`  ${result.ok} models answered, ${result.failed} failed`);
}
