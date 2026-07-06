import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMatches } from './lib/espn.js';
import { leaderboard } from './lib/scoring.js';
import { getPredictions, getSnapshots, getOutright } from './lib/store.js';
import { dbEnabled, dbTryLock } from './lib/db.js';
import {
  loadModels, predictMatches, predictorReady, buildPrompt, buildLivePrompt,
  snapshotMatches, collectOutright,
} from './lib/predictor.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'public')));

const models = loadModels();

// Transparency: the exact prompt templates, rendered from the same code
// that builds the real prompts, so the page can never drift from reality.
const templateMatch = {
  home: { name: '{HOME TEAM}', score: '{HOME GOALS}' },
  away: { name: '{AWAY TEAM}', score: '{AWAY GOALS}' },
  stage: '{STAGE}',
  kickoff: '{KICKOFF UTC}',
  venue: '{VENUE}',
  status: { detail: '{MATCH CLOCK}' },
  keyEvents: ['{GOALS AND RED CARDS SO FAR}'],
};
const promptTemplates = {
  locked: buildPrompt(templateMatch),
  live: buildLivePrompt(templateMatch),
};

// Everything the page needs in one call; the frontend polls this for
// real-time updates (live scores re-fetch upstream at most every ~25s).
app.get('/api/state', async (req, res) => {
  try {
    const all = await fetchMatches();
    const predictions = await getPredictions();
    const snapshots = await getSnapshots();
    const outright = await getOutright();
    // Display: recent and upcoming matches, plus anything ever forecast.
    // Scoring: every match in the tournament, so the leaderboard is stable.
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const matches = all.filter(
      (m) => new Date(m.kickoff).getTime() >= weekAgo || predictions[m.id]
    );
    res.json({
      now: new Date().toISOString(),
      predictorReady: predictorReady(),
      // Hosted read-only mode: forecasts arrive via ledger commits, so the
      // page should not ask visitors to configure a key.
      hosted: Boolean(process.env.VERCEL),
      demoMode: process.env.DEMO_MODE === '1',
      models,
      prompts: promptTemplates,
      outright,
      matches: matches.map((m) => ({
        ...m,
        predictions: predictions[m.id] ?? {},
        snapshots: snapshots[m.id] ?? [],
      })),
      leaderboard: leaderboard(all, predictions, models),
    });
    // Self-collection: with a database and a key, any visit keeps the
    // ledger current. Database locks bound the spend no matter how many
    // visitors hit the same staleness window.
    if (dbEnabled() && predictorReady()) {
      keepAlive(maybeCollect(all, predictions, snapshots, outright).catch((err) =>
        console.error('[collect] failed:', err.message)
      ));
    }
  } catch (err) {
    res.status(502).json({ error: `Could not load fixtures: ${err.message}` });
  }
});

// On Vercel, background work after the response needs waitUntil; locally
// a floating promise just runs on the long-lived process.
let keepAlive = (p) => { Promise.resolve(p).catch(() => {}); };
try {
  const mod = await import('@vercel/functions');
  if (mod.waitUntil) {
    keepAlive = (p) => {
      const settled = Promise.resolve(p).catch(() => {});
      try { mod.waitUntil(settled); } catch { /* outside a request context */ }
    };
  }
} catch { /* dependency absent */ }

const SNAPSHOT_STALE_MS = 12 * 60 * 1000;
const OUTRIGHT_STALE_MS = 20 * 3600 * 1000;

async function maybeCollect(all, predictions, snapshots, outright) {
  // Locked pre-kickoff forecasts for any upcoming fixture missing some.
  const pending = all.filter(
    (m) => m.status.state === 'pre' && !m.teamsTbd &&
      models.some((mod) => !predictions[m.id]?.[mod.id]?.probs)
  );
  if (pending.length && (await dbTryLock('predict', 240))) {
    console.log(`[collect] pre-kickoff forecasts: ${pending.map((m) => m.shortName).join(', ')}`);
    await predictMatches(pending, models);
  }

  // In-play: a new snapshot whenever the score or event count changed,
  // or the last one is older than 12 minutes.
  for (const m of all.filter((x) => x.status.state === 'in')) {
    const snaps = snapshots[m.id] ?? [];
    const last = snaps[snaps.length - 1];
    const score = [m.home.score ?? 0, m.away.score ?? 0];
    const events = (m.keyEvents ?? []).length;
    const stale =
      !last ||
      last.score?.[0] !== score[0] || last.score?.[1] !== score[1] ||
      (last.events ?? 0) !== events ||
      Date.now() - new Date(last.at).getTime() > SNAPSHOT_STALE_MS;
    if (stale && (await dbTryLock(`snap:${m.id}`, 90))) {
      console.log(`[collect] in-play snapshot: ${m.shortName} ${score.join('-')} (${m.status.detail})`);
      await snapshotMatches([m], models);
    }
  }

  // Trophy round: when a team was eliminated or the last round is old.
  const alive = [...new Set(
    all.filter((m) => m.status.state !== 'post')
      .flatMap((m) => [m.home, m.away]).filter((s) => s.logo).map((s) => s.name)
  )];
  const lastRound = outright[outright.length - 1];
  const sameTeams = lastRound &&
    JSON.stringify([...lastRound.teams].sort()) === JSON.stringify([...alive].sort());
  const fresh = lastRound && Date.now() - new Date(lastRound.at).getTime() < OUTRIGHT_STALE_MS;
  if (alive.length >= 2 && !(sameTeams && fresh) && (await dbTryLock('outright', 600))) {
    console.log(`[collect] trophy round for ${alive.length} teams`);
    await collectOutright(alive, models);
  }
}

// Collect forecasts for one upcoming match (matchId in body) or for every
// not-yet-started match missing forecasts. Predictions lock at kickoff.
app.post('/api/predict', async (req, res) => {
  if (!predictorReady()) {
    return res.status(400).json({
      error: 'No OPENROUTER_API_KEY configured. Set it (or DEMO_MODE=1) and restart.',
    });
  }
  try {
    const matches = await fetchMatches();
    const { matchId } = req.body ?? {};
    let targets = matches.filter((m) => m.status.state === 'pre' && !m.teamsTbd);
    if (matchId) {
      targets = targets.filter((m) => m.id === String(matchId));
      if (!targets.length) {
        return res.status(400).json({ error: 'Match not found or already kicked off, so predictions are locked.' });
      }
    }
    const results = await predictMatches(targets, models);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

export default app;

// Auto-collect: while the server runs, forecasts for upcoming matches are
// gathered ahead of kickoff without anyone clicking anything.
const AUTO_MS = 5 * 60 * 1000;
async function autoPredict() {
  if (!predictorReady()) return;
  try {
    const matches = await fetchMatches();
    const predictions = await getPredictions();
    const pending = matches.filter(
      (m) =>
        m.status.state === 'pre' &&
        !m.teamsTbd &&
        models.some((mod) => !predictions[m.id]?.[mod.id]?.probs)
    );
    if (pending.length) {
      console.log(`[auto] collecting forecasts for ${pending.map((m) => m.shortName).join(', ')}`);
      await predictMatches(pending, models);
    }
  } catch (err) {
    console.error('[auto] failed:', err.message);
  }
}
// On Vercel the app is a serverless function: no listener, no background
// interval (collection happens via the button, a cron, or a local run).
if (!process.env.VERCEL) {
  if (process.env.AUTO_PREDICT !== '0') {
    setInterval(autoPredict, AUTO_MS);
    setTimeout(autoPredict, 5000);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`brier-zero listening on http://localhost:${PORT}`);
    console.log(`predictor: ${predictorReady() ? (process.env.DEMO_MODE === '1' ? 'DEMO MODE' : 'OpenRouter') : 'NOT CONFIGURED (set OPENROUTER_API_KEY)'}`);
  });
}
