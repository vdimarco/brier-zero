import test from 'node:test';
import assert from 'node:assert/strict';
import { windowKey } from '../lib/espn.js';

// ESPN answers HTTP 400 for any YYYYMMDD-YYYYMMDD range; only a bare
// year (or month, or single day) is accepted.
test('scoreboard window is the tournament year, never a date range', () => {
  for (const now of ['2026-06-20T12:00:00Z', '2026-10-06T12:00:00Z']) {
    const key = windowKey(new Date(now));
    assert.equal(key, '2026');
    assert.doesNotMatch(key, /-/);
  }
});
