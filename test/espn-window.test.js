import test from 'node:test';
import assert from 'node:assert/strict';
import { windowKey } from '../lib/espn.js';

test('window runs 30 days ahead during the tournament', () => {
  assert.equal(windowKey(new Date('2026-06-20T12:00:00Z')), '20260611-20260720');
});

test('window end is capped at the tournament close', () => {
  assert.equal(windowKey(new Date('2026-07-15T12:00:00Z')), '20260611-20260731');
  assert.equal(windowKey(new Date('2026-10-06T12:00:00Z')), '20260611-20260731');
});
