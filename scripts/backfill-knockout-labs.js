// One-off backfill: give the promoted roster models their knockout-phase
// history from the lab backtest that selected them (data/backtests/
// knockout-labs.json), without re-spending on OpenRouter.
//
// The report stores each model's per-match Brier on the two-outcome advance
// market. On a two-way market the score determines the forecast exactly:
//   brier = (p_win - 1)^2 + (1 - p_win)^2 = 2 (1 - p_win)^2
//   =>  p_win = 1 - sqrt(brier / 2)      (the other root is > 1, invalid)
// so the reconstructed probs are the model's actual answers, not estimates.
// Records carry retro + backtest flags, same convention as other backfills.
//
//   node scripts/backfill-knockout-labs.js [--dry]

import fs from 'node:fs';
import { fetchMatches } from '../lib/espn.js';
import { getPredictions, savePrediction } from '../lib/store.js';
import { loadModels } from '../lib/predictor.js';

const dry = process.argv.includes('--dry');
// The detail file keeps the driver's raw output (labs keyed by name, models
// carrying perMatch briers); the sibling knockout-labs.json is the display
// schema the research page fetches, which drops per-match detail.
const report = JSON.parse(fs.readFileSync('data/backtests/knockout-labs-detail.json', 'utf8'));

const rosterIds = new Set(loadModels().map((m) => m.id));
const matches = new Map((await fetchMatches()).map((m) => [m.id, m]));
const existing = await getPredictions();

let written = 0;
let skipped = 0;
for (const labModels of Object.values(report.labs)) {
  for (const model of labModels) {
    if (!rosterIds.has(model.id)) continue; // only current competitors
    for (const pm of model.perMatch ?? []) {
      if (pm.brier == null) { skipped++; continue; } // that call failed
      if (existing[pm.matchId]?.[model.id]) { skipped++; continue; } // already has a record
      const match = matches.get(pm.matchId);
      if (!match || match.market !== 'advance' || !match.outcome) { skipped++; continue; }
      const pWin = 1 - Math.sqrt(pm.brier / 2);
      const probs = {
        home: match.outcome === 'home' ? pWin : 1 - pWin,
        away: match.outcome === 'away' ? pWin : 1 - pWin,
      };
      probs.home = Math.round(probs.home * 1000) / 1000;
      probs.away = Math.round((1 - probs.home) * 1000) / 1000;
      if (!dry) {
        await savePrediction(pm.matchId, model.id, {
          probs,
          market: 'advance',
          fixture: `${match.home.name} vs ${match.away.name}`,
          createdAt: new Date().toISOString(),
          eligible: true,
          retro: true,
          backtest: true,
        });
      }
      written++;
    }
  }
}
console.log(`${dry ? '[dry] would write' : 'wrote'} ${written} records, skipped ${skipped}`);
