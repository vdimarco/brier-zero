import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMatches, periodRank, txoddsStatus } from './lib/feed.js';
import { leaderboard, labLeaderboard, blocLeaderboard, predictionMarket, isKnockoutMatch } from './lib/scoring.js';
import { computeBankrolls } from './lib/bankroll.js';
import { getPredictions, getSnapshots, getOutright, getProofs } from './lib/store.js';
import { dbEnabled, dbTryLock } from './lib/db.js';
import {
  loadModels, loadEntrants, loadBlocs, predictMatches, predictorReady, buildPrompt,
  buildLivePrompt, snapshotMatches, collectOutright,
} from './lib/predictor.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'public')));
// Research lab standings (and other backtest reports) live under data/.
// Exposed read-only so /research can fetch without duplicating into public/.
app.use('/data', express.static(path.join(root, 'data'), {
  setHeaders(res) { res.setHeader('Cache-Control', 'public, max-age=60'); },
}));

const models = loadModels();
// Active roster + retired entrants: only `models` collect new forecasts,
// but scoring and display cover everyone who ever priced a match.
const entrants = loadEntrants();

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
  lockedKnockout: buildPrompt({ ...templateMatch, market: 'advance' }),
  liveKnockout: buildLivePrompt({ ...templateMatch, market: 'advance' }),
};

// Everything the page needs in one call; the frontend polls this for
// real-time updates (live scores re-fetch upstream at most every ~25s).
app.get('/api/state', async (req, res) => {
  try {
    const all = await fetchMatches();
    const predictions = await getPredictions();
    const snapshots = await getSnapshots();
    const outright = await getOutright();
    const proofs = await getProofs();
    // Display: recent and upcoming matches, plus anything ever forecast.
    // Scoring: the knockout phase and beyond — the standings and the
    // podium both read this board, so the filter lives here once.
    const scoredMatches = all.filter(isKnockoutMatch);
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
      txodds: txoddsStatus(),
      models,
      entrants,
      prompts: promptTemplates,
      outright,
      proofs,
      matches: matches.map((m) => ({
        ...m,
        predictions: predictions[m.id] ?? {},
        snapshots: snapshots[m.id] ?? [],
      })),
      leaderboard: leaderboard(scoredMatches, predictions, entrants),
      leaderboardByLab: labLeaderboard(scoredMatches, predictions, entrants),
      // By-country view: blocs scored as a consensus of their labs' picks.
      leaderboardByBloc: blocLeaderboard(scoredMatches, predictions, entrants, loadBlocs()),
      // The Bankroll: deterministic paper-trading fold over the whole ledger
      // (see lib/bankroll.js). Derived on read — same source every view uses.
      bankroll: computeBankrolls(all, predictions, entrants),
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
  // Locked pre-kickoff forecasts for any upcoming fixture missing some, or
  // whose forecast priced a different market (knockout fixture forecast
  // before the switch to the who-advances market).
  const pending = all.filter(
    (m) => m.status.state === 'pre' && !m.teamsTbd &&
      models.some((mod) => {
        const p = predictions[m.id]?.[mod.id];
        return !p?.probs || predictionMarket(p) !== (m.market ?? 'regulation');
      })
  );
  if (pending.length && (await dbTryLock('predict', 240))) {
    console.log(`[collect] pre-kickoff forecasts: ${pending.map((m) => m.shortName).join(', ')}`);
    await predictMatches(pending, models);
  }

  // In-play: a new snapshot on every event — score change, new key event
  // (goal, red card), or period change (kickoff, half-time, extra time, a
  // shootout starting) — or when the last one is older than 12 minutes.
  // Serverless invocations share no memory, so the stored snapshots are
  // the state: events and period compare against high-water marks across
  // all of them, never the flapping feed value of one poll ago.
  for (const m of all.filter((x) => x.status.state === 'in')) {
    const snaps = snapshots[m.id] ?? [];
    const last = snaps[snaps.length - 1];
    const score = [m.home.score ?? 0, m.away.score ?? 0];
    const seenEvents = Math.max(0, ...snaps.map((sn) => sn.events ?? 0));
    const seenPeriod = Math.max(0, ...snaps.map((sn) => periodRank(sn.period)));
    // Shootout kicks each grow keyEvents, but the shootout is one event:
    // the period transition into it already snapshots, so event growth
    // during the shootout does not.
    const inShootout = periodRank(m.status.name) >= periodRank('STATUS_SHOOTOUT');
    const stale =
      !last ||
      last.score?.[0] !== score[0] || last.score?.[1] !== score[1] ||
      (!inShootout && (m.keyEvents ?? []).length > seenEvents) ||
      periodRank(m.status.name) > seenPeriod ||
      Date.now() - new Date(last.at).getTime() > SNAPSHOT_STALE_MS;
    if (stale && (await dbTryLock(`snap:${m.id}`, 90))) {
      console.log(`[collect] in-play snapshot: ${m.shortName} ${score.join('-')} (${m.status.detail})`);
      await snapshotMatches([m], models);
    }
  }

  // Trophy round: when a team was eliminated or the last round is old.
  // Title contenders only: a team whose sole remaining fixture is the
  // third-place playoff is out of the final and cannot win the tournament,
  // so it must not appear in the who-wins-it-all round.
  const consolation = /3rd place|third place/i;
  const alive = [...new Set(
    all.filter((m) => m.status.state !== 'post' && !consolation.test(m.stage ?? ''))
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
    // Pending: a model has no forecast yet, or its forecast priced a
    // different market (knockout fixture forecast before the market switch).
    const pending = matches.filter(
      (m) =>
        m.status.state === 'pre' &&
        !m.teamsTbd &&
        models.some((mod) => {
          const p = predictions[m.id]?.[mod.id];
          return !p?.probs || predictionMarket(p) !== (m.market ?? 'regulation');
        })
    );
    if (pending.length) {
      console.log(`[auto] collecting forecasts for ${pending.map((m) => m.shortName).join(', ')}`);
      await predictMatches(pending, models);
    }
  } catch (err) {
    console.error('[auto] failed:', err.message);
  }
}
// In-play snapshots on every event: while a match is live, any new piece of
// information (goal, red card, score change, period change like kickoff,
// half-time, extra time, or a shootout starting) triggers a fresh in-play
// forecast from every model, plus a pulse during long quiet spells. Penalty
// kicks inside a shootout are deliberately NOT individual triggers.
const SNAP_POLL_MS = 25 * 1000;
const SNAP_PULSE_MS = 10 * 60 * 1000;
const liveSeen = new Map(); // matchId -> { score, events, period, snappedAt }
let snapshotting = false;

// New information is monotonic: a changed score, an event log that grew
// past its high-water mark, or the match moving forward into a later
// period. Feed flaps (status names alternating, events momentarily
// missing) never re-trigger a model round.
function newLiveInfo(m, now) {
  const prev = liveSeen.get(m.id);
  const score = `${m.home.score ?? 0}-${m.away.score ?? 0}`;
  const events = (m.keyEvents ?? []).length;
  const period = Math.max(periodRank(m.status.name), prev?.period ?? 0);
  if (!prev) {
    liveSeen.set(m.id, { score, events, period, snappedAt: 0 });
    return true; // just went live
  }
  const inShootout = periodRank(m.status.name) >= periodRank('STATUS_SHOOTOUT');
  const fresh =
    score !== prev.score ||
    (events > prev.events && !inShootout) ||
    period > prev.period ||
    now - prev.snappedAt > SNAP_PULSE_MS;
  prev.score = score;
  prev.events = Math.max(prev.events, events);
  prev.period = period;
  return fresh;
}

async function autoSnapshot() {
  if (!predictorReady() || snapshotting) return;
  try {
    const live = (await fetchMatches()).filter((m) => m.status.state === 'in');
    for (const id of [...liveSeen.keys()]) {
      if (!live.some((m) => m.id === id)) liveSeen.delete(id);
    }
    const now = Date.now();
    const due = live.filter((m) => newLiveInfo(m, now));
    if (!due.length) return;
    snapshotting = true;
    console.log(`[live] snapshotting ${due.map((m) => `${m.shortName} (${m.status.detail})`).join(', ')}`);
    for (const m of due) liveSeen.get(m.id).snappedAt = now;
    await snapshotMatches(due, models);
  } catch (err) {
    console.error('[live] snapshot failed:', err.message);
  } finally {
    snapshotting = false;
  }
}

// On Vercel the app is a serverless function: no listener, no background
// interval (collection happens via the button, a cron, or a local run).
if (!process.env.VERCEL) {
  if (process.env.AUTO_PREDICT !== '0') {
    setInterval(autoPredict, AUTO_MS);
    setTimeout(autoPredict, 5000);
  }
  if (process.env.AUTO_SNAPSHOT !== '0') {
    setInterval(autoSnapshot, SNAP_POLL_MS);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`brier-zero listening on http://localhost:${PORT}`);
    console.log(`predictor: ${predictorReady() ? (process.env.DEMO_MODE === '1' ? 'DEMO MODE' : 'OpenRouter') : 'NOT CONFIGURED (set OPENROUTER_API_KEY)'}`);
  });
}
