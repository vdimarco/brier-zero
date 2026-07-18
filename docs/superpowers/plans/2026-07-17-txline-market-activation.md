# TxLINE Market Activation + Solana Proof Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on "The Market" (`txodds/market`) as a scored leaderboard entrant backfilled across the tournament, and verify resolved scores against TxLINE's on-chain `daily_scores_roots` commitment on Solana.

**Architecture:** The integration surface already exists on this branch: `lib/txodds.js` (auth, fixtures, odds, de-vig, `marketProbs` with `asOf`), `lib/feed.js` (odds enrichment), the `txodds/market` roster entry, `scripts/txodds-setup.mjs` (token activation), and retro-backfill via `backfillMatches(targets, models)` which prices the market at `asOf: match.kickoff`. This plan only (1) provisions credentials on devnet, (2) adds a `--only` flag so the market can be backfilled without OpenRouter calls, (3) adds read-side Merkle proof verification against the devnet program, (4) surfaces a verification badge.

**Tech Stack:** Node 18+ ESM, `node --test`, `node:crypto` sha256/ed25519, `@solana/web3.js` (new dep, Task 3 only). No TypeScript, no build step.

## Global Constraints

- Update spec context: the spec's proposed `lib/txline.js` / `scripts/txline-setup.js` / `scripts/backfill-market.js` are superseded by the existing `lib/txodds.js` / `scripts/txodds-setup.mjs` / `scripts/backfill.js` — extend those, do not create parallel modules.
- Entrant id is `txodds/market` (already in `models.config.json`); never introduce another id.
- All TxLINE data calls go through `apiGet` in `lib/txodds.js` (guest JWT + `X-Api-Token` headers, retry on 401).
- Devnet by default: origin `https://txline-dev.txodds.com`, program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`; mainnet program `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` via `TXODDS_ENV=mainnet`.
- TxLINE failures must never break the feed or the server (match existing best-effort style).
- Secrets (`.env`, keypairs) are never committed. `data/txodds-wallet.json` must be gitignored in Task 1.
- Tests: `npm test` (`node --test test/*.test.js`) must pass after every task.
- Commit after every task (small, descriptive commits).

---

### Task 1: Devnet credentials — subscribe on-chain and activate the API token

Operational task (one small file change). Produces a working `TXODDS_API_TOKEN` in `.env`.

**Files:**
- Modify: `.gitignore` (add wallet path)
- Create: `.env` (from `.env.example`, not committed)
- Create: `data/txodds-wallet.json` (generated keypair, not committed)

**Interfaces:**
- Produces: `.env` with `TXODDS_API_TOKEN=<token>` and `TXODDS_ENV=devnet`, consumed by `txoddsReady()` in `lib/txodds.js`.

- [ ] **Step 1: Gitignore the wallet before it exists**

Append to `.gitignore`:

```
data/txodds-wallet.json
```

Run: `git add .gitignore && git commit -m "chore: ignore txodds devnet wallet"`

- [ ] **Step 2: Generate a devnet keypair and airdrop SOL**

```bash
solana-keygen new --no-bip39-passphrase -o data/txodds-wallet.json
solana airdrop 2 "$(solana-keygen pubkey data/txodds-wallet.json)" --url devnet
solana balance "$(solana-keygen pubkey data/txodds-wallet.json)" --url devnet
```

Expected: balance ≥ 1 SOL. If the `solana` CLI is absent, install via `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` first. If the public airdrop is rate-limited, use https://faucet.solana.com with the printed pubkey.

- [ ] **Step 3: Send the free-tier subscribe transaction**

Use the sponsor's official example (the subscribe instruction needs their Anchor IDL; do not hand-roll it):

```bash
git clone https://github.com/txodds/tx-on-chain /tmp/tx-on-chain
cd /tmp/tx-on-chain && npm install
# Point the example at our wallet, then run the devnet free-tier script:
ANCHOR_WALLET=/Users/vaughn/Github/brier-zero/data/txodds-wallet.json \
  npx ts-node examples/devnet/scripts/subscription_free_tier.ts
```

Expected: prints a confirmed transaction signature. Record it as `TXSIG`. (Exact env-var/arg names may differ — read the script header first; it is a short example file. The only requirements: it signs with our keypair and targets devnet program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`.)

- [ ] **Step 4: Activate the API token**

```bash
cd /Users/vaughn/Github/brier-zero
node scripts/txodds-setup.mjs --txsig "$TXSIG" --keypair data/txodds-wallet.json --env devnet
```

Expected: prints `TXODDS_API_TOKEN=<long token>`. Create `.env` from `.env.example`; set `TXODDS_API_TOKEN` and `TXODDS_ENV=devnet`.

- [ ] **Step 5: Verify data access end-to-end**

```bash
node scripts/txodds-probe.mjs
```

Expected: World Cup fixtures list and at least one odds snapshot print without auth errors. If the probe script takes flags, run `node scripts/txodds-probe.mjs --help` first.

---

### Task 2: Backfill "The Market" across the tournament

**Files:**
- Modify: `scripts/backfill.js`
- Test: `test/backfill-args.test.js` (create)

**Interfaces:**
- Consumes: `backfillMatches(matches, models)` from `lib/predictor.js` (already prices market models at `asOf: match.kickoff`); `loadModels()`; `isMarketModel(model)` from `lib/predictor.js`.
- Produces: `parseOnly(argv, models)` exported from `scripts/backfill.js`; store records under `predictions[matchId]['txodds/market']` with `retro: true`, consumed by `leaderboard()` unchanged.

- [ ] **Step 1: Write the failing test for the `--only` filter**

Create `test/backfill-args.test.js`:

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/backfill-args.test.js`
Expected: FAIL — `parseOnly` is not exported.

- [ ] **Step 3: Implement `parseOnly` and wire it into the script**

In `scripts/backfill.js`, add the export and use it. The script currently builds `targets` from matches where any roster model lacks probs; both the target filter and the `backfillMatches` call must use the filtered roster:

```js
export function parseOnly(argv, models) {
  const i = argv.indexOf('--only');
  if (i === -1) return models;
  const id = argv[i + 1];
  const picked = models.filter((m) => m.id === id);
  if (!picked.length) {
    throw new Error(
      `--only ${id}: not in the roster. Ids: ${models.map((m) => m.id).join(', ')}`
    );
  }
  return picked;
}
```

Then in the script body replace the fixed `loadModels()` roster with:

```js
const models = parseOnly(process.argv.slice(2), loadModels());
```

and pass it through: targets filter checks `models.some((mod) => !preds[m.id]?.[mod.id]?.probs)` (already does once `models` is the filtered list), and the collection call becomes `backfillMatches(targets, models)`.

Guard: the top-of-script `predictorReady()` check stays — with only `TXODDS_API_TOKEN` set it passes via `txoddsReady()`.

Note: `scripts/backfill.js` runs top-level code on import. Wrap the existing body in `if (process.env.NODE_TEST_CONTEXT == null) { ... }` or move it under `if (import.meta.url === `file://${process.argv[1]}`)` so the test can import `parseOnly` without executing a backfill. Prefer the `import.meta.url` main-module guard.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass, including the three new ones.

- [ ] **Step 5: Run the market backfill for real**

```bash
node scripts/backfill.js --only txodds/market
```

Expected output shape: `Backfilling ~102 matches × 1 models...` then per-match `1 collected` lines. Historical odds gaps surface as errors per match — that is fine and expected; note the count.

- [ ] **Step 6: Verify coverage and the leaderboard row**

```bash
node -e "
import('./lib/store.js').then(async ({ getPredictions }) => {
  const p = await getPredictions();
  const rows = Object.values(p).filter((m) => m['txodds/market']?.probs);
  console.log('market records:', rows.length);
});
"
PORT=3001 npm start &   # if not already running
curl -s localhost:3001/api/state | node -e "
let s=''; process.stdin.on('data',(d)=>s+=d).on('end',()=>{
  const r=JSON.parse(s).leaderboard.find((x)=>x.model==='txodds/market');
  console.log(r);
});"
```

Expected: a `txodds/market` leaderboard row with `scored > 0`, `retroScored === scored` (so the UI renders it as a ★ backtest entrant automatically — that is the correct presentation and needs no UI change). Record the coverage fraction (scored / 104) for the submission doc.

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill.js test/backfill-args.test.js data/store.json
git commit -m "feat: backfill The Market from TxLINE historical odds (--only filter)"
```

(`data/store.json` is the committed audit ledger — including the new market records is intentional; see `lib/store.js` header.)

---

### Task 3: Read-side score-proof verification against Solana

**Files:**
- Modify: `lib/txodds.js` (proof fetch + Merkle recompute)
- Create: `scripts/verify-results.js`
- Modify: `lib/store.js` (proofs bucket)
- Modify: `server.js` (expose proofs in `/api/state`)
- Test: `test/proof.test.js` (create), `test/fixtures/stat-validation.json` (captured)

**Interfaces:**
- Consumes: `apiGet(path)` (internal to `lib/txodds.js`), `fetchScoresSnapshot(fixtureId)`, `fetchFixtures()`, `matchFixture(espnMatch, fixtures)` from `lib/txodds.js`; `fetchMatches()` from `lib/feed.js`.
- Produces:
  - `fetchStatValidation(fixtureId, seq, statKey)` → raw proof payload (new export, `lib/txodds.js`)
  - `recomputeRoot(payload)` → `{ root: <hex string>, statValue }` (new export, `lib/txodds.js`) — pure, no I/O
  - `getProofs()` / `saveProof(matchId, proof)` (new exports, `lib/store.js`), stored under `state.proofs[matchId]`
  - proof objects: `{ matchId, fixtureId, seq, statKey, root, onchainRoot, verified, epochDay, pda, cluster, explorerUrl, at }`

- [ ] **Step 1: Capture a real proof payload as a test fixture**

```bash
node -e "
import('./lib/txodds.js').then(async (tx) => {
  const fixtures = await tx.fetchFixtures();
  const done = fixtures.find((f) => new Date(f.kickoff) < new Date('2026-07-10'));
  const scores = await tx.fetchScoresSnapshot(done.fixtureId);
  console.log(JSON.stringify(scores, null, 2).slice(0, 3000));
});"
```

From the score snapshot, pick a real `seq` and the final-score `statKey` (the docs' example uses `statKey: 1002`; confirm which key the snapshot labels as the full-time score — never use `seq: 0`). Then fetch the proof and save it verbatim:

```bash
mkdir -p test/fixtures
node -e "
import('./lib/txodds.js').then(async (tx) => {
  const p = await tx.fetchStatValidation(FIXTURE_ID, SEQ, STAT_KEY); // fill the three literals from the previous step
  require('node:fs').writeFileSync('test/fixtures/stat-validation.json', JSON.stringify(p, null, 2));
});"
```

(`fetchStatValidation` does not exist yet — for this capture only, inline the call: `apiGet('/scores/stat-validation?fixtureId=...&seq=...&statKey=...')` is not exported, so temporarily use `curl` with the two auth headers, or add the export first as an empty passthrough. Simplest: write Step 3's `fetchStatValidation` export now — it is four lines — then run this capture.)

Inspect the saved payload. It should contain `summary`, `subTreeProof`, `mainTreeProof`, `statToProve`, `eventStatRoot`, `statProof` (per the sponsor's on-chain-validation docs). **The exact hash-node encoding (byte order, left/right flags, hash function) must be read off this payload — adjust Step 4's recompute code to match what you see before writing the test's expected root.**

- [ ] **Step 2: Write the failing test**

Create `test/proof.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recomputeRoot } from '../lib/txodds.js';

const payload = JSON.parse(fs.readFileSync('test/fixtures/stat-validation.json', 'utf8'));

test('recomputeRoot reproduces the payload main root from the leaf proofs', () => {
  const { root } = recomputeRoot(payload);
  // The payload carries the root it commits to (top of mainTreeProof chain);
  // recomputing from statToProve up must land on exactly that value.
  assert.equal(typeof root, 'string');
  assert.match(root, /^[0-9a-f]{64}$/);
  assert.equal(root, payload.expectedRootForTest); // set in Step 1 from the captured payload's own root field
});

test('recomputeRoot fails closed on a tampered stat', () => {
  const tampered = structuredClone(payload);
  tampered.statToProve = { ...tampered.statToProve, value: 999 };
  const { root } = recomputeRoot(tampered);
  assert.notEqual(root, payload.expectedRootForTest);
});
```

When saving the fixture in Step 1, copy the payload's own committed-root field (whatever it is named — e.g. the last `mainTreeProof` node or a `mainRoot` field) into an added `expectedRootForTest` property so the test is self-contained.

- [ ] **Step 3: Run it to make sure it fails**

Run: `node --test test/proof.test.js`
Expected: FAIL — `recomputeRoot` is not exported.

- [ ] **Step 4: Implement proof fetch + Merkle recompute in `lib/txodds.js`**

Append a proofs section:

```js
// ----------------------------------------------------------------- proofs ----

// Raw stat-validation payload: Merkle proofs tying one stat (e.g. the
// full-time score) to the daily root TxODDS commits on-chain.
export async function fetchStatValidation(fixtureId, seq, statKey) {
  return apiGet(
    `/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`
  );
}

import { createHash } from 'node:crypto'; // move to the top imports

const sha256 = (buf) => createHash('sha256').update(buf).digest();

// Fold a Merkle path: each node is { hash, right } (directional flag names
// per the captured payload — adjust here if the fixture uses e.g. `isLeft`).
function foldPath(leaf, nodes) {
  let acc = leaf;
  for (const n of nodes) {
    const sibling = Buffer.from(n.hash, 'hex');
    acc = n.right ? sha256(Buffer.concat([acc, sibling]))
                  : sha256(Buffer.concat([sibling, acc]));
  }
  return acc;
}

// Recompute the committed daily root from the proof payload alone (no I/O):
// stat leaf -> statProof -> eventStatRoot -> subTreeProof -> mainTreeProof.
export function recomputeRoot(payload) {
  const leaf = sha256(Buffer.from(JSON.stringify(payload.statToProve)));
  const eventRoot = foldPath(leaf, payload.statProof ?? []);
  const subRoot = foldPath(eventRoot, payload.subTreeProof ?? []);
  const root = foldPath(subRoot, payload.mainTreeProof ?? []);
  return { root: root.toString('hex'), statValue: payload.statToProve };
}
```

**This code is written against the documented field names; reconcile every field/flag name and the leaf-encoding against the captured fixture from Step 1 before running the test.** The leaf encoding in particular (JSON vs packed bytes) must be taken from the payload/sponsor examples in `github.com/txodds/tx-on-chain` — their `examples/devnet` includes validation examples showing the exact leaf hashing; read that script and mirror it.

- [ ] **Step 5: Run the test until the recompute matches**

Run: `node --test test/proof.test.js`
Expected: PASS both tests. If the root does not match, diff your fold order/flags against the sponsor's validation example — do not weaken the test.

- [ ] **Step 6: Add the proofs bucket to the store**

In `lib/store.js`: in `loadFile()`, add `state.proofs ??= {};` next to the existing `state.outright ??= [];`. Then add at the bottom, following the file's existing async API style:

```js
export async function getProofs() {
  return loadFile().proofs;
}

export async function saveProof(matchId, proof) {
  const s = loadFile();
  s.proofs[matchId] = proof;
  persistFile();
}
```

(File backend only: proofs are derived, re-runnable data; the Supabase path is out of scope. If `dbEnabled()` reads bypass `loadFile()` for other buckets, keep proofs file-local regardless — the verify script and the server both run where the file exists.)

- [ ] **Step 7: Write `scripts/verify-results.js`**

```js
// CLI: for every finished match, fetch the final-score validation proof,
// recompute the Merkle root locally, and compare it with the root TxODDS
// committed on Solana (daily_scores_roots PDA). Read-side verification:
// no transaction is sent and the wallet is not needed.
import { Connection, PublicKey } from '@solana/web3.js';
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

const ENV = (process.env.TXODDS_ENV || 'mainnet').toLowerCase();
const PROGRAM = new PublicKey(
  ENV === 'devnet'
    ? '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'
    : '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'
);
const RPC = process.env.SOLANA_RPC_URL ||
  (ENV === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');
const conn = new Connection(RPC, 'confirmed');

const FULL_TIME_SCORE_STAT_KEY = Number(process.env.TXODDS_SCORE_STAT_KEY || 1002); // confirm in Task 3 Step 1

function dailyRootsPda(epochDay) {
  const le = Buffer.alloc(2);
  le.writeUInt16LE(epochDay);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('daily_scores_roots'), le],
    PROGRAM
  )[0];
}

// The account data layout is read off the sponsor's validation example
// (anchor discriminator 8 bytes, then the roots). We only need "does our
// recomputed 32-byte root appear in the account data".
async function onchainHasRoot(epochDay, rootHex) {
  const pda = dailyRootsPda(epochDay);
  const info = await conn.getAccountInfo(pda);
  if (!info) return { pda, found: false, reason: 'PDA account not found' };
  const hex = info.data.toString('hex');
  return { pda, found: hex.includes(rootHex), reason: null };
}

const proofs = await getProofs();
const done = (await fetchMatches()).filter(
  (m) => m.status.state === 'post' && !m.teamsTbd && !proofs[m.id]?.verified
);
console.log(`Verifying ${done.length} matches (${ENV})...`);
const fixtures = await fetchFixtures();
let ok = 0, failed = 0, skipped = 0;
for (const m of done) {
  try {
    const found = matchFixture(m, fixtures);
    if (!found) { skipped++; continue; }
    const { fixtureId } = found.fixture;
    const scores = await fetchScoresSnapshot(fixtureId);
    // Pick the newest score record's seq (payload shape confirmed in Step 1).
    const records = Array.isArray(scores) ? scores : scores?.data ?? [scores];
    const seq = records.map((r) => r?.seq ?? r?.Seq).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (!seq) { skipped++; continue; }
    const payload = await fetchStatValidation(fixtureId, seq, FULL_TIME_SCORE_STAT_KEY);
    const { root } = recomputeRoot(payload);
    const epochDay = Math.floor(new Date(m.kickoff).getTime() / 86_400_000);
    const chain = await onchainHasRoot(epochDay, root);
    const proof = {
      matchId: m.id, fixtureId, seq, statKey: FULL_TIME_SCORE_STAT_KEY,
      root, verified: chain.found, epochDay,
      pda: chain.pda.toBase58(), cluster: ENV,
      explorerUrl: `https://explorer.solana.com/address/${chain.pda.toBase58()}${ENV === 'devnet' ? '?cluster=devnet' : ''}`,
      at: new Date().toISOString(),
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
```

Install the dependency: `npm install @solana/web3.js`

- [ ] **Step 8: Run verification for real**

Run: `node scripts/verify-results.js`
Expected: per-match `verified ✓` lines; a nonzero verified count. Failures print loudly with reasons and are stored `verified: false` — acceptable, but investigate the first few (epochDay off-by-one against the fixture's own kickoff date and account-layout assumptions are the likely causes; the fixture's TxLINE kickoff, not ESPN's, defines its epoch day — if mismatched, derive `epochDay` from `found.fixture.kickoff`).

- [ ] **Step 9: Expose proofs in `/api/state`**

In `server.js`, the `/api/state` handler already assembles `{ matches, leaderboard, ... }` from the store. Add:

```js
import { getProofs } from './lib/store.js';   // extend the existing store import
// inside the /api/state handler, alongside the other awaits:
const proofs = await getProofs();
// and include `proofs` in the res.json payload object.
```

Run: `curl -s localhost:3001/api/state | grep -o '"proofs"' ` → prints `"proofs"`.

- [ ] **Step 10: Run the whole test suite and commit**

Run: `npm test` — expected: PASS.

```bash
git add lib/txodds.js lib/store.js server.js scripts/verify-results.js test/proof.test.js test/fixtures/stat-validation.json package.json package-lock.json data/store.json
git commit -m "feat: verify resolved scores against TxLINE's on-chain daily roots"
```

---

### Task 4: "Verified on Solana" badge + submission doc

**Files:**
- Modify: `public/app.js`
- Modify: `public/app.css`
- Modify: `docs/submission-worldcup.md`

**Interfaces:**
- Consumes: `state.proofs[matchId]` from `/api/state` (Task 3 Step 9 shape).

- [ ] **Step 1: Add the badge to finished match cards**

In `public/app.js`, the match card is built in the function containing the `${match.marketOdds ? oddsStrip(match) : ''}` line (~line 317). Add next to it, for finished matches only:

```js
function proofBadge(state, match) {
  const p = state.proofs?.[match.id];
  if (!p?.verified) return '';
  return `<a class="proof-badge" href="${p.explorerUrl}" target="_blank" rel="noopener"
    title="Final score Merkle-proved against the root TxODDS committed on Solana (epoch day ${p.epochDay})">
    Score verified on Solana ✓</a>`;
}
```

and render `${proofBadge(state, match)}` inside the finished-match card markup, after the odds strip. (The render functions already receive `state` — `renderMatches(state)` at ~line 659 — thread it through if the card builder only takes `match`.)

In `public/app.css`:

```css
.proof-badge {
  display: inline-block; margin-top: 4px; font-size: 11px;
  color: #14f195; text-decoration: none; opacity: 0.85;
}
.proof-badge:hover { opacity: 1; text-decoration: underline; }
```

(Match the existing css variable scheme if one exists — reuse an existing accent variable instead of the hex if `app.css` defines one.)

- [ ] **Step 2: Eyeball it**

Run: `PORT=3001 npm start`, open `http://localhost:3001`. Expected: finished matches with stored proofs show the green badge; clicking opens the Solana explorer at the PDA.

- [ ] **Step 3: Update the submission doc**

In `docs/submission-worldcup.md`, add a short section (3–6 sentences, no marketing fluff): The Market entrant is backfilled from TxLINE historical StablePrice odds (state the real coverage, e.g. "N of 104 matches", from Task 2 Step 6); resolved scores are verified read-side against the `daily_scores_roots` commitment (name the program id and cluster actually used); command names: `scripts/backfill.js --only txodds/market`, `scripts/verify-results.js`.

- [ ] **Step 4: Commit and push**

```bash
git add public/app.js public/app.css docs/submission-worldcup.md
git commit -m "feat: Solana score-verification badge; submission notes"
git push
```

---

## Self-review notes

- Spec coverage: spec §1–2 (client/setup) satisfied by pre-existing code + Task 1; §3 mapping exists (`matchFixture`); §4 backfill = Task 2; §5 proofs = Task 3; §6 UI = Task 4 (leaderboard ★ handling already covers the entrant row); §7 coverage labeling: the ★ backtest explainer + submission-doc coverage line replace the bespoke "coverage window" row — the leaderboard already shows `scored` counts per entrant.
- Honest uncertainty: proof payload field names/flags and the PDA account layout are taken from sponsor docs and MUST be reconciled against the captured fixture (Task 3 Steps 1, 4, 8 say exactly where). The test in Task 3 is anchored to a real captured payload, so a wrong guess cannot silently pass.
- Devnet historical-odds coverage is unknown until Task 2 Step 5 runs; the fallback (mainnet, `TXODDS_ENV=mainnet`, needs a real-SOL subscribe) is documented in `docs/txodds-integration.md` and does not change any code.
