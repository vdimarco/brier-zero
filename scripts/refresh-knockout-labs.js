// Refresh data/backtests/knockout-labs.json (the /research lab board)
// from the CURRENT prediction ledger, without re-spending on OpenRouter.
//
// Roster entrants get their avgBrier recomputed from the live ledger's
// knockout records (locked forecasts; retro backfills carry the same
// convention) — this also seats new entrants like Mistral. Backtest-only
// candidate models that never joined the roster (e.g. Opus 4.8) keep the
// numbers from the original lab backtest: they exist nowhere else.
//
//   node scripts/refresh-knockout-labs.js
import fs from 'node:fs';
import { fetchMatches } from '../lib/feed.js';
import { getPredictions } from '../lib/store.js';
import { loadEntrants } from '../lib/predictor.js';
import { brierScore, fixtureMatches, predictionMarket, isKnockoutMatch } from '../lib/scoring.js';

const FILE = 'data/backtests/knockout-labs.json';
const report = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// One scale only: the board's metric is ADVANCE-market Brier (two-way
// coin flip = 0.500), so only advance-priced records score here. Early
// knockout rounds were forecast under the old 90-minute market by the
// then-active roster — those records score on the site leaderboard but
// would sit on a 0.667 baseline and skew this board, so long-running
// models show fewer scored ties than retro-backfilled ones.
const matches = (await fetchMatches()).filter(
  (m) => m.market === 'advance' && m.status?.state === 'post' && m.outcome
);
void isKnockoutMatch;
const predictions = await getPredictions();
const entrants = loadEntrants().filter((m) => m.provider !== 'txodds');

// Score one entrant over every finished knockout tie it priced.
function scoreEntrant(id) {
  let sum = 0;
  let scored = 0;
  for (const match of matches) {
    const p = predictions[match.id]?.[id];
    if (!p?.probs || !p.eligible || !fixtureMatches(p, match)) continue;
    if (predictionMarket(p) !== 'advance') continue;
    const outcome = match.outcomes ? (match.outcomes.advance ?? null) : match.outcome;
    if (!outcome) continue;
    sum += brierScore(p.probs, outcome, 'advance');
    scored++;
  }
  return scored ? { avgBrier: Math.round((sum / scored) * 1000) / 1000, scored } : null;
}

// Short display label: drop the lab name prefix the board already shows.
const shortLabel = (m) => {
  const labWord = (m.labLabel ?? '').split(' ')[0];
  return labWord && m.label.startsWith(labWord + ' ') ? m.label.slice(labWord.length + 1) : m.label;
};

// The original backtest file predates the roster's lab ids — fold its
// labs onto the canonical ids so roster refreshes land in the same lab.
const LAB_ALIAS = { zhipu: 'z-ai', moonshot: 'moonshotai', xai: 'x-ai' };
for (const l of report.labs) l.id = LAB_ALIAS[l.id] ?? l.id;
{
  const seen = new Map();
  report.labs = report.labs.filter((l) => {
    const first = seen.get(l.id);
    if (!first) { seen.set(l.id, l); return true; }
    for (const m of l.models) if (!first.models.some((x) => x.id === m.id)) first.models.push(m);
    return false;
  });
}

const byLab = new Map(report.labs.map((l) => [l.id, l]));
for (const ent of entrants) {
  const labId = ent.lab ?? ent.id;
  let lab = byLab.get(labId);
  if (!lab) {
    lab = { id: labId, label: ent.labLabel ?? labId, icon: ent.icon ?? null, status: 'complete', models: [] };
    byLab.set(labId, lab);
    report.labs.push(lab);
  }
  const s = scoreEntrant(ent.id);
  if (!s) continue;
  let row = lab.models.find((m) => m.id === ent.id);
  if (!row) { row = { id: ent.id, label: shortLabel(ent) }; lab.models.push(row); }
  row.avgBrier = s.avgBrier;
  row.scored = s.scored;
  row.requested = matches.length;
  delete row.note;
  delete row.status;
}

for (const lab of report.labs) {
  let best = null;
  for (const m of lab.models) {
    delete m.bestInLab;
    if (m.avgBrier != null && (best == null || m.avgBrier < best.avgBrier)) best = m;
  }
  if (best) best.bestInLab = true;
  lab.status = lab.models.every((m) => m.avgBrier != null && m.scored >= matches.length) ? 'complete'
    : lab.models.some((m) => m.avgBrier != null) ? 'partial' : 'pending';
}

report.method = 'ledger + retro-backtest';
report.matchCount = matches.length;
report.updatedAt = new Date().toISOString();
report.status = report.labs.every((l) => l.status === 'complete') ? 'complete' : 'partial';
report.note = `Advance-market Brier only (two-way coin flip = 0.500). Roster models scored from the live prediction ledger; backtest-only candidate models keep their original lab-backtest numbers. Long-running models priced early knockout rounds under the old 90-minute market, so they show fewer scored ties.`;

fs.writeFileSync(FILE, JSON.stringify(report, null, 2) + '\n');
const total = report.labs.reduce((n, l) => n + l.models.length, 0);
console.log(`${report.labs.length} labs · ${total} models · ${matches.length} knockout ties · status ${report.status}`);
