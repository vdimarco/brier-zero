// Live watcher: polls the ESPN feed while matches are in play and prints
// one line whenever there is NEW INFORMATION (goal, red card, score
// change, kickoff, full time) plus a pulse every 15 minutes of quiet
// play. Each printed line is a signal to collect an in-play snapshot.
// Exits when nothing is live and no kickoff is within 25 minutes.
import { fetchMatches } from '../lib/espn.js';

const POLL_MS = 45 * 1000;
const PULSE_MS = 15 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fingerprints = new Map();
let lastSignal = Date.now();
let consecutiveErrors = 0;

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

  let signalled = false;
  for (const m of live) {
    const fp = `${m.home.score}-${m.away.score}|${(m.keyEvents ?? []).length}`;
    if (fingerprints.get(m.id) !== fp) {
      const last = (m.keyEvents ?? []).slice(-1)[0];
      console.log(
        fingerprints.has(m.id)
          ? `CHANGE ${m.shortName} ${m.home.score}-${m.away.score} at ${m.status.detail}${last ? ` | ${last}` : ''}`
          : `KICKOFF ${m.shortName} is live`
      );
      fingerprints.set(m.id, fp);
      signalled = true;
    }
  }
  for (const id of [...fingerprints.keys()]) {
    const m = matches.find((x) => x.id === id);
    if (m && m.status.state === 'post') {
      console.log(`FT ${m.shortName} ${m.home.score}-${m.away.score}`);
      fingerprints.delete(id);
      signalled = true;
    }
  }
  if (!signalled && live.length && Date.now() - lastSignal > PULSE_MS) {
    console.log(`PULSE ${live.map((m) => `${m.shortName} ${m.status.detail}`).join(', ')}`);
    signalled = true;
  }
  if (signalled) lastSignal = Date.now();
  await sleep(POLL_MS);
}
