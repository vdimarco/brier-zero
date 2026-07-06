// CLI: collect outright tournament-winner forecasts from every model.
// Skips when the latest entry is fresh (< 20h) and the set of remaining
// teams has not changed, so it is safe to run on every routine pass.
import { fetchMatches } from '../lib/espn.js';
import { collectOutright, predictorReady } from '../lib/predictor.js';
import { getOutright } from '../lib/store.js';

if (!predictorReady()) {
  console.error('Set OPENROUTER_API_KEY (or DEMO_MODE=1) first.');
  process.exit(1);
}
const matches = await fetchMatches();
const alive = [...new Set(
  matches
    .filter((m) => m.status.state !== 'post')
    .flatMap((m) => [m.home, m.away])
    .filter((s) => s.logo)
    .map((s) => s.name)
)];
if (alive.length < 2) {
  console.log('Tournament decided; nothing to collect.');
  process.exit(0);
}
const history = await getOutright();
const last = history[history.length - 1];
const sameTeams = last && JSON.stringify([...last.teams].sort()) === JSON.stringify([...alive].sort());
const fresh = last && Date.now() - new Date(last.at).getTime() < 20 * 3600 * 1000;
if (sameTeams && fresh) {
  console.log('Outright forecast is fresh; skipping.');
  process.exit(0);
}
console.log(`Collecting outright winner forecasts for ${alive.length} teams...`);
const r = await collectOutright(alive);
console.log(`  ${r.ok} models answered, ${r.failed} failed`);
