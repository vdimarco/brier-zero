# TxODDS TxLINE integration — "The Market" competitor

The Brier Cup's ninth competitor is not a language model. It is the betting
market: TxODDS's **StablePrice** consensus line (bookmaker odds aggregated,
filtered, and anchored on Solana), converted into probabilities and scored
with the same multi-category Brier score as every AI model. This document
covers how it works and how to switch it on.

## What TxLINE provides

[TxLINE](https://txline-docs.txodds.com) is TxODDS's on-chain data service.
For the FIFA World Cup it has a **free tier** — no TxL token payment, no
card — that serves:

| Data | Endpoint | Used for |
|---|---|---|
| Fixtures | `GET /api/fixtures/snapshot?competitionId=72&startEpochDay=…` | Matching TxLINE fixtures to our ESPN match ids |
| Odds | `GET /api/odds/snapshot/{fixtureId}` (`?asOf=` for historical) | The Market's forecasts, live odds strip |
| Scores | `GET /api/scores/snapshot/{fixtureId}`, `/api/scores/stream` (SSE) | Cross-checks; available for future use |
| Proofs | validation endpoints | On-chain verification of the data itself |

Two mainnet service levels are free for the World Cup: level 1 (60 s
delayed) and level 12 (real time). Devnet (`txline-dev.txodds.com`) offers
level 1 with zero sampling delay for development.

## Auth model

Every API call carries two headers:

```
Authorization: Bearer <guest JWT>     # free, renewed automatically
X-Api-Token: <activated API token>    # yours, from the one-time setup
```

`lib/txodds.js` handles guest-JWT acquisition/renewal transparently; you
only supply `TXODDS_API_TOKEN`.

## One-time setup

1. **Subscribe on-chain** (once, needs a Solana wallet with a little SOL
   for fees — zero TxL for the World Cup free tier):
   - easiest: the TxLINE app at <https://txline.txodds.com> — connect
     wallet, choose the free World Cup tier; or
   - scripted: `subscription_free_tier.ts` in
     [txodds/tx-on-chain](https://github.com/txodds/tx-on-chain)
     (`examples/devnet/scripts/`).
   Keep the transaction signature (`txSig`).
   Programs: mainnet `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`,
   devnet `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`.

2. **Activate the API token** with the same wallet's keypair (the key never
   leaves your machine — signing is in-process `node:crypto` ed25519):

   ```bash
   node scripts/txodds-setup.mjs \
     --txsig <subscribe-tx-signature> \
     --keypair ~/.config/solana/id.json \
     --env mainnet          # or devnet
   ```

3. Put the printed `TXODDS_API_TOKEN=…` into `.env` and restart. "The
   Market" seats itself: it appears on the leaderboard, collects locked
   forecasts before kickoff, reprices during matches, and match cards
   grow a live-odds strip.

4. **Sanity-check the payload mapping** (recommended on first run):

   ```bash
   node scripts/txodds-probe.mjs                 # normalized fixtures
   node scripts/txodds-probe.mjs <fixtureId>     # + raw odds & scores
   ```

   `lib/txodds.js` field-hunts across the documented envelope spellings;
   if TxLINE's actual payloads use names the mapper misses, the probe's raw
   dump shows exactly what to add to `normalizeFixture()` /
   `extractPrices()` (both unit-tested in `test/txodds.test.js`).

## How the market's forecast is computed

1. ESPN match → TxLINE fixture: normalized team names (FIFA vs common
   spellings, `lib/txodds.js` `ALIASES`) + kickoff within six hours;
   orientation honours `Participant1IsHome`.
2. Odds snapshot → newest message with a usable decimal 1X2 triple.
3. De-vig by normalization: `p_i = (1/odds_i) / Σ(1/odds_j)`. The
   overround is preserved in the stored record (`odds.overround`) for
   transparency.
4. Group stage: those three probabilities are the forecast. Knockout
   ("who advances"): the draw mass is split by relative strength —
   `P(home adv) = h + d·h/(h+a)` — a documented, tested approximation until
   a to-qualify offer is mapped.
5. The record is stored exactly like a model forecast (`txodds/market` in
   the ledger), locks at kickoff, and is Brier-scored identically. During
   matches the live line is re-snapshotted alongside the models' in-play
   re-forecasts.

Design rule inherited from the repo: **best-effort everywhere**. Missing
token, unmatched fixture, unparseable payload — the market simply skips
that cycle and the ESPN-backed app keeps running untouched.

## Environment variables

```
TXODDS_API_TOKEN=        # required to enable the integration
TXODDS_ENV=mainnet       # or devnet
TXODDS_COMPETITION_ID=72 # FIFA World Cup on the TxLINE feed
TXODDS_API_ORIGIN=       # explicit origin override (rare)
SOLANA_RPC_URL=          # optional; defaults to public cluster RPC
```

### Production (Vercel)

The leaderboard and Solana verification badges load from the committed
ledger in `data/store.json` even when the token is unset. **Live odds
strips** and runtime backfill need the token on the serverless function:

1. In the Vercel project for `worldcup.uptick.fyi`, set Production env:
   - `TXODDS_API_TOKEN` (from `scripts/txodds-setup.mjs`)
   - `TXODDS_ENV` (`devnet` or `mainnet` — match the token’s cluster)
2. Redeploy (or wait for the next git push).
3. Confirm: `GET /api/state` → `txodds.configured === true`.

Never commit `.env` or `data/txodds-wallet.json`.

## Score verification (Solana)

```bash
node scripts/verify-results.js
```

For each finished match with a TxLINE final-score sequence, the script
fetches a stat-validation proof, recomputes the Merkle root locally
(`recomputeRoot` in `lib/txodds.js`), and checks it against the
`daily_scores_roots` PDA on the TxODDS program. Results land in
`data/store.json` under `proofs[matchId]`; the UI renders
**Score verified on Solana ✓** when `verified: true`.

Unit tests for the Merkle fold live in `test/proof.test.js` against a
captured payload in `test/fixtures/stat-validation.json`.
