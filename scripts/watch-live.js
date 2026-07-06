// Live watcher: polls the ESPN feed while matches are in play and collects
// an in-play snapshot from every model whenever there is NEW INFORMATION
// (goal, red card, score change, kickoff, half-time or extra time starting)
// plus a pulse every 10 minutes of quiet play. Individual penalty kicks in
// a shootout do not trigger. Exits when nothing is live and no kickoff is
// within 25 minutes. Set OPENROUTER_API_KEY (or DEMO_MODE=1) to collect;
// without it the watcher only prints the signals.
import { fetchMatches } from '../lib/espn.js';
import { snapshotMatches, predictorReady } from '../lib/predictor.js';

const POLL_MS = 30 * 1000;
const PULSE_MS = 10 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tracked = new Map(); // matchId -> { score, events, period }
let lastSignal = Date.now();
let consecutiveErrors = 0;

// New information means the score changed, the event log GREW past its
// previous high-water mark, or the match moved FORWARD into a later
// period. The feed sometimes flaps (events momentarily missing, status
// name reverting between edge servers); monotonic comparisons keep a
// flap from re-triggering a full model round every poll.
const PERIOD_RANK = {
  STATUS_FIRST_HALF: 1,
  STATUS_HALFTIME: 2,
  STATUS_SECOND_HALF: 3,
  STATUS_END_OF_REGULATION: 4,
  STATUS_OVERTIME: 5,
  STATUS_HALFTIME_ET: 6,
  STATUS_SHOOTOUT: 7,
};
const MIN_SNAPSHOT_GAP_MS = 90 * 1000; // score changes ignore this

function newInformation(m) {
  const prev = tracked.get(m.id);
  const score = `${m.home.score ?? 0}-${m.away.score ?? 0}`;
  const events = (m.keyEvents ?? []).length;
  const period = PERIOD_RANK[m.status.name] ?? prev?.period ?? 0;
  if (!prev) {
    tracked.set(m.id, { score, events, period, lastSnap: Date.now() });
    return 'kickoff';
  }
  const reasons = [];
  if (score !== prev.score) reasons.push(`score ${prev.score} -> ${score}`);
  if (events > prev.events) reasons.push(`events ${prev.events} -> ${events}`);
  if (period > prev.period) reasons.push(`period ${prev.period} -> ${period}`);
  prev.score = score;
  prev.events = Math.max(prev.events, events);
  prev.period = Math.max(prev.period, period);
  if (!reasons.length) return null;
  const scoreChanged = reasons[0].startsWith('score');
  if (!scoreChanged && Date.now() - prev.lastSnap < MIN_SNAPSHOT_GAP_MS) return null;
  prev.lastSnap = Date.now();
  return reasons.join(', ');
}

async function collect(matches) {
  if (!matches.length) return;
  if (!predictorReady()) {
    console.log('  (no OPENROUTER_API_KEY / DEMO_MODE, snapshot skipped)');
    return;
  }
  for (const r of await snapshotMatches(matches)) {
    console.log(`  snapshot ${r.shortName}: ${r.ok} models answered, ${r.failed} failed`);
  }
}

for (;;) {
  let matches;
  try {
    matches = await fetchMatches({ force: true });
    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors >= 10) {
      console.log(`ERROR feed unreachable 10 times in a row: ${err.message}`);
      process.exit(1);
    }
    await sleep(POLL_MS);
    continue;
  }

  const live = matches.filter((m) => m.status.state === 'in');
  const soon = matches.filter(
    (m) => m.status.state === 'pre' && !m.teamsTbd && new Date(m.kickoff) - Date.now() < 25 * 60 * 1000
  );
  if (!live.length && !soon.length && !tracked.size) {
    console.log('IDLE no live matches and none within 25 minutes; watcher exiting');
    process.exit(0);
  }

  const changed = [];
  for (const m of live) {
    const reason = newInformation(m);
    if (reason) {
      const last = (m.keyEvents ?? []).slice(-1)[0];
      console.log(
        reason === 'kickoff'
          ? `KICKOFF ${m.shortName} is live`
          : `CHANGE ${m.shortName} ${m.home.score}-${m.away.score} at ${m.status.detail} (${reason})${last ? ` | ${last}` : ''}`
      );
      changed.push(m);
    }
  }
  for (const id of [...tracked.keys()]) {
    const m = matches.find((x) => x.id === id);
    if (m && m.status.state === 'post') {
      console.log(`FT ${m.shortName} ${m.home.score}-${m.away.score}`);
      tracked.delete(id);
    }
  }
  if (!changed.length && live.length && Date.now() - lastSignal > PULSE_MS) {
    console.log(`PULSE ${live.map((m) => `${m.shortName} ${m.status.detail}`).join(', ')}`);
    changed.push(...live);
  }
  if (changed.length) {
    lastSignal = Date.now();
    await collect(changed);
  }
  await sleep(POLL_MS);
}
