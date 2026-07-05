// CLI: collect one in-play snapshot from every model for each live match.
// Run repeatedly during matches; each run appends a timestamped entry.
import { fetchMatches } from '../lib/espn.js';
import { snapshotMatches, predictorReady } from '../lib/predictor.js';

if (!predictorReady()) {
  console.error('Set OPENROUTER_API_KEY (or DEMO_MODE=1) first.');
  process.exit(1);
}
const live = (await fetchMatches()).filter((m) => m.status.state === 'in');
if (!live.length) {
  console.log('No live matches.');
  process.exit(0);
}
console.log(`Snapshotting ${live.map((m) => m.shortName).join(', ')}...`);
for (const r of await snapshotMatches(live)) {
  console.log(`  ${r.shortName}: ${r.ok} models answered, ${r.failed} failed`);
}
