// CLI: for every finished match, fetch the final-score validation proof
// and simulate TxODDS's on-chain validateStat against the daily_scores_roots
// PDA. Read-side verification: no transaction is sent (Anchor .view()).
//
// Requires a funded Solana keypair only as the simulation fee-payer
// (devnet: data/txodds-wallet.json). The key never signs a real tx.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { fetchMatches } from '../lib/feed.js';
import {
  fetchFixtures, matchFixture, fetchScoresSnapshot,
  fetchStatValidation, recomputeRoot, txoddsReady,
} from '../lib/txodds.js';
import { getProofs, saveProof } from '../lib/store.js';

if (!txoddsReady()) {
  console.error('Set TXODDS_API_TOKEN first (see docs/txodds-integration.md).');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV = (process.env.TXODDS_ENV || 'mainnet').toLowerCase();
const PROGRAM_ID = new PublicKey(
  ENV === 'devnet'
    ? '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'
    : '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'
);
const RPC = process.env.SOLANA_RPC_URL ||
  (ENV === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');

// Confirmed by capturing a real payload (fixtureId 17588223, seq 1024,
// game_finalised): the score record's Stats map always carries key 1002
// as the full-time-score stat, and the stat-validation response's own
// statToProve.key echoes it back.
const FULL_TIME_SCORE_STAT_KEY = Number(process.env.TXODDS_SCORE_STAT_KEY || 1002);

function loadKeypair() {
  const p = process.env.SOLANA_KEYPAIR
    || process.env.ANCHOR_WALLET
    || path.join(ROOT, 'data/txodds-wallet.json');
  if (!fs.existsSync(p)) {
    console.error(`Solana keypair not found at ${p}. Set SOLANA_KEYPAIR or place the wallet at data/txodds-wallet.json.`);
    process.exit(1);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

function loadIdl() {
  // Prefer the checked-in IDL; fall back to the path used by the official examples.
  const candidates = [
    path.join(ROOT, 'data/idl/txoracle.json'),
    path.join(ROOT, 'idl/txoracle.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const idl = JSON.parse(fs.readFileSync(c, 'utf8'));
      idl.address = PROGRAM_ID.toBase58();
      return idl;
    }
  }
  console.error('Missing data/idl/txoracle.json (from github.com/txodds/tx-on-chain).');
  process.exit(1);
}

function toBytes32(value) {
  const bytes = Array.isArray(value) ? Uint8Array.from(value)
    : value instanceof Uint8Array ? value
    : Buffer.from(value);
  if (bytes.length !== 32) throw new Error(`Expected 32-byte hash, got ${bytes.length}`);
  return Array.from(bytes);
}

function toProofNodes(nodes) {
  return (nodes ?? []).map((n) => ({
    hash: toBytes32(n.hash),
    isRightSibling: !!n.isRightSibling,
  }));
}

function dailyRootsPda(epochDay) {
  const le = Buffer.alloc(2);
  le.writeUInt16LE(epochDay);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('daily_scores_roots'), le],
    PROGRAM_ID
  )[0];
}

// Simulate program.methods.validateStat(...).view() — the sponsor's own
// read-side verification path. Locally we still recompute intermediate
// Merkle roots (eventStatRoot / eventStatsSubTreeRoot) as a cheap
// integrity check before paying for the RPC simulation.
async function verifyOnChain(program, payload) {
  const targetTs = payload?.summary?.updateStats?.minTimestamp ?? payload?.ts;
  if (!Number.isFinite(targetTs)) throw new Error('proof missing summary.updateStats.minTimestamp');
  const epochDay = Math.floor(targetTs / 86_400_000);
  const pda = dailyRootsPda(epochDay);

  // Local recompute is best-effort (the unit tests lock the leaf encoding
  // against a captured fixture). Some live payloads with value=0 stats
  // don't fold cleanly under that encoding but still pass the program's
  // own validateStat — so we never gate on the local check; only report it.
  let local;
  try { local = recomputeRoot(payload); } catch { local = { root: null }; }

  const fixtureSummary = {
    fixtureId: new BN(payload.summary.fixtureId),
    updateStats: {
      updateCount: payload.summary.updateStats.updateCount,
      minTimestamp: new BN(payload.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(payload.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes32(payload.summary.eventStatsSubTreeRoot),
  };
  const stat1 = {
    statToProve: payload.statToProve,
    eventStatRoot: toBytes32(payload.eventStatRoot),
    statProof: toProofNodes(payload.statProof),
  };
  // equalTo(own value): proves the Merkle path is valid and the stat is
  // exactly what the API claims — not a trading predicate.
  const predicate = {
    threshold: payload.statToProve.value,
    comparison: { equalTo: {} },
  };

  try {
    const isValid = await program.methods
      .validateStat(
        new BN(targetTs),
        fixtureSummary,
        toProofNodes(payload.subTreeProof),
        toProofNodes(payload.mainTreeProof),
        predicate,
        stat1,
        null,
        null
      )
      .accounts({ dailyScoresMerkleRoots: pda })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .view();
    return {
      verified: !!isValid,
      epochDay,
      pda,
      root: local.root,
      reason: isValid ? null : 'validateStat returned false',
    };
  } catch (err) {
    const logs = err?.simulationResponse?.logs?.slice(-5)?.join(' | ');
    return {
      verified: false,
      epochDay,
      pda,
      root: local.root,
      reason: `validateStat error: ${err.message || err}${logs ? ` (${logs})` : ''}`,
    };
  }
}

const connection = new Connection(RPC, 'confirmed');
const wallet = new anchor.Wallet(loadKeypair());
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
const program = new anchor.Program(loadIdl(), provider);

const force = process.argv.includes('--force');
const proofs = await getProofs();
const done = (await fetchMatches()).filter(
  (m) => m.status.state === 'post' && !m.teamsTbd && (force || !proofs[m.id]?.verified)
);
console.log(`Verifying ${done.length} matches (${ENV}, program ${PROGRAM_ID.toBase58().slice(0, 8)}…)…`);
// fetchFixtures()'s default window only reaches back ~1 week; finished
// group-stage matches are much older, so pull the whole tournament (the
// TxLINE World Cup competition kicked off 2026-06-10).
const fixtures = await fetchFixtures({
  sinceEpochDay: Math.floor(Date.UTC(2026, 5, 10) / 86_400_000),
});
let ok = 0, failed = 0, skipped = 0;
for (const m of done) {
  try {
    const found = matchFixture(m, fixtures);
    if (!found) { skipped++; console.log(`  ${m.shortName}: skip (no fixture)`); continue; }
    const { fixtureId } = found.fixture;
    const scores = await fetchScoresSnapshot(fixtureId);
    // Prefer the game_finalised record (the settlement-grade score); fall
    // back to the newest record's Seq if none is present yet.
    const records = Array.isArray(scores) ? scores : scores?.data ?? [scores];
    const finalised = records.filter((r) => r?.Action === 'game_finalised' || r?.action === 'game_finalised');
    const pool = finalised.length ? finalised : records;
    const seq = pool
      .map((r) => r?.Seq ?? r?.seq)
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (!seq) { skipped++; console.log(`  ${m.shortName}: skip (no seq)`); continue; }
    const payload = await fetchStatValidation(fixtureId, seq, FULL_TIME_SCORE_STAT_KEY);
    const chain = await verifyOnChain(program, payload);
    // Materialize the Merkle path for the settlement-proof receipt (UI). Purely
    // additive: the pass/fail decision above is untouched. Each sibling is
    // recorded leaf→root with its fold side; local() gives the intermediate roots.
    const toHex = (arr) => Buffer.from(arr).toString('hex');
    const flatten = (nodes) => (nodes ?? []).map((n) => ({ hash: toHex(n.hash), side: n.isRightSibling ? 'right' : 'left' }));
    let local = { eventRoot: null, subRoot: null };
    try { local = recomputeRoot(payload); } catch { /* keep nulls */ }
    const proof = {
      matchId: m.id,
      fixtureId,
      seq,
      statKey: FULL_TIME_SCORE_STAT_KEY,
      root: chain.root,
      onchainRoot: chain.verified ? chain.root : null,
      verified: chain.verified,
      epochDay: chain.epochDay,
      pda: chain.pda.toBase58(),
      cluster: ENV,
      explorerUrl: `https://explorer.solana.com/address/${chain.pda.toBase58()}${ENV === 'devnet' ? '?cluster=devnet' : ''}`,
      // Receipt detail (consumed by the proof modal). Absent on older records.
      statToProve: payload.statToProve,
      eventRoot: local.eventRoot,
      subRoot: local.subRoot,
      merklePath: [
        ...flatten(payload.statProof),
        ...flatten(payload.subTreeProof),
        ...flatten(payload.mainTreeProof),
      ],
      at: new Date().toISOString(),
      method: 'validateStat.view',
      ...(chain.reason ? { reason: chain.reason } : {}),
    };
    await saveProof(m.id, proof);
    proof.verified ? ok++ : failed++;
    console.log(`  ${m.shortName}: ${proof.verified ? 'verified ✓' : `NOT verified (${chain.reason ?? 'root mismatch'})`}`);
  } catch (err) {
    failed++;
    console.log(`  ${m.shortName}: error ${err.message}`);
  }
}
console.log(`Done: ${ok} verified, ${failed} failed, ${skipped} skipped (no fixture/seq).`);
