import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMatches } from './lib/espn.js';
import { leaderboard } from './lib/scoring.js';
import { getPredictions } from './lib/store.js';
import { loadModels, predictMatches, predictorReady } from './lib/predictor.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'public')));

const models = loadModels();

// Everything the page needs in one call; the frontend polls this for
// real-time updates (live scores re-fetch upstream at most every ~25s).
app.get('/api/state', async (req, res) => {
  try {
    const matches = await fetchMatches();
    const predictions = getPredictions();
    res.json({
      now: new Date().toISOString(),
      predictorReady: predictorReady(),
      demoMode: process.env.DEMO_MODE === '1',
      models,
      matches: matches.map((m) => ({ ...m, predictions: predictions[m.id] ?? {} })),
      leaderboard: leaderboard(matches, predictions, models),
    });
  } catch (err) {
    res.status(502).json({ error: `Could not load fixtures: ${err.message}` });
  }
});

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
    let targets = matches.filter((m) => m.status.state === 'pre');
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

// Auto-collect: while the server runs, forecasts for upcoming matches are
// gathered ahead of kickoff without anyone clicking anything.
const AUTO_MS = 5 * 60 * 1000;
async function autoPredict() {
  if (!predictorReady()) return;
  try {
    const matches = await fetchMatches();
    const predictions = getPredictions();
    const pending = matches.filter(
      (m) =>
        m.status.state === 'pre' &&
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
if (process.env.AUTO_PREDICT !== '0') {
  setInterval(autoPredict, AUTO_MS);
  setTimeout(autoPredict, 5000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`brier-zero listening on http://localhost:${PORT}`);
  console.log(`predictor: ${predictorReady() ? (process.env.DEMO_MODE === '1' ? 'DEMO MODE' : 'OpenRouter') : 'NOT CONFIGURED (set OPENROUTER_API_KEY)'}`);
});
