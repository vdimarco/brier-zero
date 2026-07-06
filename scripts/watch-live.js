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

const fingerprints = new Map();
let lastSignal = Date.now();
let consecutiveErrors = 0;

const fingerprint = (m) => `${m.home.score}-${m.away.score}|${(m.keyEvents ?? []).length}|${m.status.name}`;

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
  if (!live.length && !soon.length && !fingerprints.size) {
    console.log('IDLE no live matches and none within 25 minutes; watcher exiting');
    process.exit(0);
  }

  const changed = [];
  for (const m of live) {
    const fp = fingerprint(m);
    if (fingerprints.get(m.id) !== fp) {
      const last = (m.keyEvents ?? []).slice(-1)[0];
      console.log(
        fingerprints.has(m.id)
          ? `CHANGE ${m.shortName} ${m.home.score}-${m.away.score} at ${m.status.detail}${last ? ` | ${last}` : ''}`
          : `KICKOFF ${m.shortName} is live`
      );
      fingerprints.set(m.id, fp);
      changed.push(m);
    }
  }
  for (const id of [...fingerprints.keys()]) {
    const m = matches.find((x) => x.id === id);
    if (m && m.status.state === 'post') {
      console.log(`FT ${m.shortName} ${m.home.score}-${m.away.score}`);
      fingerprints.delete(id);
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
