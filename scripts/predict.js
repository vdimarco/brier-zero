// CLI: collect forecasts for all upcoming matches, then exit.
// Handy for cron: run it a few hours before each matchday.
import { fetchMatches } from '../lib/espn.js';
import { predictMatches, predictorReady, loadModels } from '../lib/predictor.js';

if (!predictorReady()) {
  console.error('Set OPENROUTER_API_KEY (or DEMO_MODE=1) first.');
  process.exit(1);
}
const matches = (await fetchMatches()).filter((m) => m.status.state === 'pre');
if (!matches.length) {
  console.log('No upcoming matches in window.');
  process.exit(0);
}
console.log(`Collecting forecasts for ${matches.length} matches × ${loadModels().length} models...`);
const results = await predictMatches(matches);
for (const r of results) {
  const ok = r.models.filter((m) => m.status === 'ok').length;
  const exists = r.models.filter((m) => m.status === 'exists').length;
  const errs = r.models.filter((m) => m.status === 'error');
  console.log(`  ${r.shortName}: ${ok} new, ${exists} already stored, ${errs.length} errors`);
  for (const e of errs) console.log(`    ! ${e.model}: ${e.error}`);
}
