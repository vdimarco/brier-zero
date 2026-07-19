import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recomputeRoot } from '../lib/txodds.js';

// Captured live from TxLINE devnet: fixtureId 17588223 (Mexico v South
// Korea), seq 1024 (the `game_finalised` score record), statKey 1002
// (full-time score). See test/fixtures/stat-validation.json.
//
// The real payload's field names/shapes differ from the sponsor docs'
// generic pseudocode in a few ways that matter for the recompute:
//   - statToProve is { key, value, period } (numbers), not a hex leaf.
//   - eventStatRoot / summary.eventStatsSubTreeRoot / proof node `hash`
//     are plain byte arrays (number[32]), not hex strings.
//   - proof nodes use `isRightSibling` (bool), not `right`.
//   - there is no single top-level "committed root" field in the
//     payload — the daily main root lives only on-chain (see
//     scripts/verify-results.js). What the payload DOES commit to,
//     verifiably, are two intermediate roots: `eventStatRoot` (top of
//     statProof) and `summary.eventStatsSubTreeRoot` (top of
//     subTreeProof, which happens to equal `expectedRootForTest` here).
const payload = JSON.parse(
  fs.readFileSync(new URL('./fixtures/stat-validation.json', import.meta.url), 'utf8')
);

test('recomputeRoot folds statProof up to the payload\'s own eventStatRoot', () => {
  const { eventRoot } = recomputeRoot(payload);
  assert.equal(eventRoot, Buffer.from(payload.eventStatRoot).toString('hex'));
});

test('recomputeRoot folds subTreeProof up to the payload\'s own eventStatsSubTreeRoot', () => {
  const { subRoot } = recomputeRoot(payload);
  assert.equal(subRoot, Buffer.from(payload.summary.eventStatsSubTreeRoot).toString('hex'));
  assert.equal(subRoot, payload.expectedRootForTest);
});

test('recomputeRoot produces a well-formed main-tree root', () => {
  const { root } = recomputeRoot(payload);
  assert.equal(typeof root, 'string');
  assert.match(root, /^[0-9a-f]{64}$/);
});

test('recomputeRoot fails closed on a tampered stat', () => {
  const tampered = structuredClone(payload);
  tampered.statToProve = { ...tampered.statToProve, value: 999 };
  const original = recomputeRoot(payload);
  const changed = recomputeRoot(tampered);
  assert.notEqual(changed.eventRoot, original.eventRoot);
  assert.notEqual(changed.subRoot, original.subRoot);
  assert.notEqual(changed.root, original.root);
});
