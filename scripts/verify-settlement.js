// CLI: verify one match's settlement receipt end to end.
//
//   node --env-file=.env scripts/verify-settlement.js <matchId>
//
// Thin wrapper over the existing check-gate code — no new logic:
// fetchStatValidation pulls the proof payload for the match's stored
// fixture, recomputeRoot (lib/txodds.js) folds leaf -> statProof ->
// eventStatRoot -> subTreeProof -> mainTreeProof exactly as the on-chain
// validateStat does, and the result is compared to the daily root
// recorded from the `daily_scores_roots` PDA on Solana (stored by
// scripts/verify-results.js and shown on the site's receipt modal).
import { fetchStatValidation, recomputeRoot, txoddsReady } from '../lib/txodds.js';
import { getProofs } from '../lib/store.js';

const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node --env-file=.env scripts/verify-settlement.js <matchId>');
  process.exit(1);
}
if (!txoddsReady()) {
  console.error('Set TXODDS_API_TOKEN first (node --env-file=.env ..., see docs/txodds-integration.md).');
  process.exit(1);
}

const proofs = await getProofs();
const rec = proofs[matchId];
if (!rec) {
  console.error(`No settlement record for match ${matchId}. Known matches: ${Object.keys(proofs).join(', ')}`);
  process.exit(1);
}

const payload = await fetchStatValidation(rec.fixtureId, rec.seq, rec.statKey ?? 1002);
const out = recomputeRoot(payload);

const hex = (h) => (typeof h === 'string' ? h : Buffer.from(h.hash ?? h).toString('hex'));
console.log(`match ${matchId} · fixture ${rec.fixtureId} · stat key ${rec.statKey ?? 1002} (full-time score)`);
console.log('\nleaf preimage (statToProve):');
console.log(`  ${JSON.stringify(payload.statToProve)}`);
for (const [name, nodes] of [
  ['statProof (leaf -> eventStatRoot)', payload.statProof],
  ['subTreeProof (-> eventStatsSubTreeRoot)', payload.subTreeProof],
  ['mainTreeProof (-> daily root)', payload.mainTreeProof],
]) {
  console.log(`\n${name}:`);
  for (const n of nodes ?? []) console.log(`  ${n.isRightSibling ? 'R' : 'L'} ${hex(n)}`);
}
console.log(`\ncomputed daily root:  ${out.root}`);
console.log(`on-chain daily root:  ${rec.onchainRoot} (${rec.cluster}, epoch day ${rec.epochDay})`);
console.log(`PDA:                  ${rec.pda}`);
console.log(`explorer:             ${rec.explorerUrl}`);

const ok = out.root === rec.onchainRoot;
console.log(`\n${ok ? 'VERIFIED — recomputed root matches the root committed on Solana.' : 'FAILED — recomputed root does not match the on-chain root.'}`);
process.exit(ok ? 0 : 1);
