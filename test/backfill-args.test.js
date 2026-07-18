import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnly } from '../scripts/backfill.js';

const models = [
  { id: 'txodds/market', label: 'The Market', provider: 'txodds' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude' },
];

test('no --only keeps the full roster', () => {
  assert.deepEqual(parseOnly([], models), models);
});

test('--only filters to the named model id', () => {
  const out = parseOnly(['--only', 'txodds/market'], models);
  assert.deepEqual(out.map((m) => m.id), ['txodds/market']);
});

test('--only with an unknown id throws with the roster in the message', () => {
  assert.throws(() => parseOnly(['--only', 'nope'], models), /txodds\/market/);
});
