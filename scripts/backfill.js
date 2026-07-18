// CLI: retroactively forecast finished matches that have no forecasts,
// using the exact pre-kickoff prompt. Records are flagged retro: true.
// The models' training data predates this tournament, so they cannot know
// the results; retro records still lack the pre-kickoff timestamp proof.
import { fetchMatches } from '../lib/espn.js';
import { backfillMatches, predictorReady, loadModels } from '../lib/predictor.js';
import { getPredictions } from '../lib/store.js';

if (!predictorReady()) {
  console.error('Set OPENROUTER_API_KEY (or DEMO_MODE=1) first.');
  process.exit(1);
}
const preds = await getPredictions();
const models = loadModels();
// Any finished match where at least one model has no stored forecast.
const targets = (await fetchMatches()).filter(
  (m) =>
    m.status.state === 'post' &&
    !m.teamsTbd &&
    models.some((mod) => !preds[m.id]?.[mod.id]?.probs)
);
if (!targets.length) {
  console.log('Nothing to backfill.');
  process.exit(0);
}
console.log(`Backfilling ${targets.length} matches × ${loadModels().length} models...`);
for (const r of await backfillMatches(targets)) {
  const ok = r.models.filter((m) => m.status === 'ok').length;
  const errs = r.models.filter((m) => m.status === 'error');
  console.log(`  ${r.shortName}: ${ok} collected, ${errs.length} errors`);
  for (const e of errs) console.log(`    ! ${e.error}`);
}
