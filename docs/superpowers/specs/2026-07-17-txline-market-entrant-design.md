# TxLINE "The Market" Entrant + Solana-Verified Results — Design

**Date:** 2026-07-17
**Context:** Superteam World Cup hackathon (deadline 2026-07-19, trading-agents track).
Sponsor requirement: integrate TXOdds' TxLINE API (Solana-anchored football data).
**Repo state:** brier-zero World Cup branch — 8 AI models forecast every match, Brier-scored
against real results via `lib/espn.js` → `lib/scoring.js` → leaderboard.

## Goal

Put the actual betting market on the Brier leaderboard as a scored entrant
(**the-market**), backfilled across the whole tournament from TxLINE historical
odds, and make match resolutions cryptographically verifiable via TxLINE's
Solana validation proofs. Answer the question the arena exists to ask:
**did any AI model beat the bookies?**

Out of scope: replacing ESPN as the fixtures/scores source; submitting on-chain
`validateStatV2` transactions (read-side verification only); any change to
`lib/espn.js`, `lib/scoring.js`, or `lib/predictor.js`.

## Components

### 1. `lib/txline.js` — TxLINE client (only new library module)

- `authenticate()` — obtains a guest JWT (`POST {host}/auth/guest/start`),
  pairs it with the stored API token; caches both; transparently re-auths on 401.
- `fetchFixtures()` — schedule pull, filtered to fixture groups matching
  `World Cup`, normalized to `{ fixtureId, home, away, kickoff, stage }`.
- `fetchOddsHistory(epochDay, hourOfDay, interval)` — raw
  `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}`.
- `fetchOddsSnapshot(fixtureId)` — `GET /api/odds/snapshot/{fixtureId}`.
- `fetchScoreProof(fixtureId, seq, statKey)` —
  `GET /api/scores/stat-validation` proof payload.
- Host: devnet `https://txline-dev.txodds.com` by default; `TXLINE_HOST`
  env var overrides (mainnet fallback is `https://txline.txodds.com`).
- Retries on 429/500/502/503/504 with backoff, mirroring `lib/espn.js`.

### 2. `scripts/txline-setup.js` — one-time credential bootstrap

1. Load or generate a Solana keypair at `data/txline-wallet.json` (**gitignored**).
2. Request a devnet SOL airdrop if balance is insufficient.
3. Send the on-chain `subscribe(serviceLevel=1, weeks)` transaction to the
   TxLINE program (standard bundle, empty league selection).
4. Sign the activation message `${txSig}::${jwt}` with the wallet.
5. `POST /api/token/activate` → write `TXLINE_API_TOKEN` and `TXLINE_TX_SIG`
   to `.env`.

Idempotent: with a working token already present it verifies and exits.

### 3. Fixture mapping — `data/txline-map.json`

TxLINE `fixtureId` ↔ ESPN match id, matched on normalized team names plus
kickoff time within ±2 hours. Produced by the backfill script on first run.
Unmatched fixtures on either side are printed loudly and recorded under an
`unmatched` key — never silently dropped.

### 4. `scripts/backfill-market.js` — the-market entrant

For each played match (resumable — skips matches that already carry a
`the-market` record):

1. Walk `odds/updates` windows for the hours preceding kickoff; take the
   **last pre-kickoff** match-odds update for the fixture.
2. Convert decimal odds → implied probabilities (`1/odds`), then normalize
   out the overround (divide each by the sum).
3. Collapse to the market the models price, per `marketOf()` conventions:
   group-stage → 3-way `{home, draw, away}`; knockout → 2-way advance market.
4. Append an entrant record for **`the-market`** to `data/store.json` in
   exactly the shape of a model forecast, so `lib/scoring.js` ranks it with
   zero changes.

### 5. `scripts/verify-results.js` — read-side proof verification

For each resolved match: fetch the final-score stat proof (a real `seq` from
the score record, never `seq=0`), recompute the Merkle path locally
(subTreeProof → mainTreeProof), read the `daily_scores_roots` PDA for that
epoch day via `@solana/web3.js`, and compare roots. Persist
`{ verified, pda, slot, explorerUrl }` per match in the store. A mismatch is
recorded as `verified: false` with the details — never hidden.

### 6. UI

- Leaderboard: **The Market** appears as a marked entrant (same pattern as
  the ★ Gemini backtest row; mark: ⚖) with a one-line explainer.
- Resolved matches with a stored proof show a **"Score verified on Solana ✓"**
  badge linking to the explorer (devnet cluster param included).
- Short copy block on the arena page: what the benchmark is, where the odds
  come from, what the verification badge means.

## Data flow

```
TxLINE fixtures ──┐
                  ├─ txline-map.json (id mapping, ±2h + name match)
ESPN matches ─────┘
TxLINE odds history ─ backfill-market.js ─ the-market records → store.json → scoring → leaderboard
TxLINE stat proofs ── verify-results.js ── Merkle check vs daily_scores_roots PDA → badges
```

## Error handling

- All TxLINE calls: bounded retries on retriable statuses, then a loud
  per-item failure that leaves previously written data intact.
- Backfill and verification are both resumable and idempotent.
- **Coverage risk:** devnet historical odds may not reach back to the June 11
  opening match. If a gap exists, the entrant's row states its coverage
  window explicitly (e.g. "from Jun 20 — 74 of 102 matches") instead of
  implying a full record; mainnet level 1 (60s delay, pennies of real SOL)
  is the documented fallback via `TXLINE_HOST`.

## Testing

`node --test` units for:

- odds → probability conversion, including overround normalization and the
  knockout 2-way collapse;
- fixture name matching (accents, "USA"/"United States"-style aliases, ±2h);
- Merkle path recomputation against a captured proof payload fixture.

Live check: backfill one group-stage day end-to-end, confirm the leaderboard
renders **The Market** with Brier scores.

## Dependencies

`@solana/web3.js` (new). Nothing else changes.
