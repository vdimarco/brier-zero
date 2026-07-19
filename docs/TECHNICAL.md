# The Brier Cup — Technical Documentation

**Live:** https://worldcup.uptick.fyi · **Track:** Prediction Markets &
Settlement (Superteam × TxODDS World Cup hackathon)

## Core idea

Ten frontier AI models and the real betting market (TxODDS StablePrice,
de-vigged) forecast all 104 FIFA World Cup 2026 matches from one identical
prompt — no odds, no news; the prompt is rendered on-site from the same code
that builds the real ones. Forecasts and market lines lock at kickoff. Every
settled score is verified through independent check gates against TxODDS's
Merkle daily roots anchored on Solana, and the verified results drive two
resolution systems: a Brier-score leaderboard (probabilistic calibration,
shrunken-skill ranked) and The Bankroll — deterministic quarter-Kelly paper
trading against the locked line, with fully public per-model bet ledgers.

## Architecture

```
TxLINE (Solana) ──► ingest ──► de-vig ──► LOCK at kickoff ──► result (ESPN feed)
                                              │                     │
                              OpenRouter ──► forecasts          Merkle check gate
                              (10 models,     (locked)          (leaf → path → root
                               1 prompt)          │              vs on-chain daily root)
                                                  ▼                     │
                                        settlement fold ◄──────────────┘
                                        (pure function)
                                                  │
                                Brier scores · Bankroll P&L · bet ledgers
                                                  ▼
                                        live site (SSR + API)
```

The pipeline is fully autonomous: scheduled ingest → forecast → lock →
verify → settle → publish, with zero manual input since deployment.

## Technical highlights

- **Verification layer (check gates).** Every settled score is recomputed as
  a Merkle leaf and verified sibling-by-sibling against the TxODDS daily root
  committed on Solana. The "Score verified on Solana" badge renders only when
  leaf → path → root recomputes exactly; the gate fails closed. Each badge
  opens a full receipt — leaf preimage, sibling path, root, and a direct
  Solscan link to the on-chain commitment. A traceable record of the outcome
  with no external oracle to trust. At submission time: **78/78 settled
  matches with a published TxLINE score record verify on-chain.**
- **Deterministic settlement.** The entire scoring-and-settlement state is a
  pure fold over `(locked forecasts, locked lines, verified results)` in
  match order — no randomness, no wall-clock dependence. Replaying the
  tournament reproduces every Brier score, bet, stake, and rank
  byte-identically (`node scripts/bankroll.js` twice → identical output).
- **Lock discipline.** Only pre-kickoff data counts anywhere in the system.
  In-play TxLINE updates stream as exhibition forecasts by design, so
  nothing scored can be revised after the ball moves.
- **Honest market scoring.** Bookmaker margin (vig) is stripped from
  StablePrice 1X2 prices before scoring, so the market competes on its true
  implied probabilities. Group-stage scoring is the 90-minute 1X2 result
  (draws real); knockouts score who advances.
- **Betting rules (Bankroll).** Per match, per model: edge = p·d − 1 against
  the locked line; single bet on the max-edge outcome only when edge > 2%;
  stake = quarter-Kelly, capped at 10% of bankroll. 1X2 bets settle at the
  **raw** StablePrice decimals — vig included, so a model only profits by
  beating the bookmaker margin, the honest version. Knockout advance bets
  settle at fair (de-vigged) odds `d = 1/q`, since no single "advances"
  price is quoted (disclosed in the UI). A bet settles in the market its
  forecast priced — the same rule the leaderboard scores by — so every
  model has a decision row on all settled matches. Paper trading, virtual
  units only.
- **Ranking integrity.** Leaderboard rank uses shrunken skill vs the
  coin-flip baseline — (baseline − Brier) ÷ baseline per match, averaged
  with ten phantom coin-flip matches — so new entrants start neutral and
  cannot fluke to the top.

## Business / product highlights

- **Verifiable-resolution UX:** one-click cryptographic receipts on every
  settled match — a pattern reusable by any prediction platform settling on
  TxLINE data.
- **Divergence surface:** every match card shows each model's probabilities
  against the market line, and the public bet ledger records the
  model-vs-market edge per bet with a resolved did-it-pay history —
  deployable as a standalone signal surface.
- **Audit-trail module:** the check-gate verification code
  (`lib/txodds.js` `recomputeRoot`, `scripts/verify-settlement.js`) is
  self-contained and reusable for compliance and backtesting against
  TxLINE's on-chain commitments.

## TxLINE / TxODDS surfaces used

Auth on every call: a free guest JWT from `POST /auth/guest/start` plus the
activated `X-Api-Token` from the one-time on-chain subscribe + activate flow
(`scripts/txodds-setup.mjs`). Base: `https://txline.txodds.com/api`
(devnet: `https://txline-dev.txodds.com/api`). World Cup competition id 72.

- **StablePrice consensus 1X2 odds** — `GET /api/fixtures/snapshot?competitionId=72&startEpochDay=…`
  to map fixtures, then `GET /api/odds/snapshot/{fixtureId}` (optionally
  `?asOf=<epoch-ms>` for the historical pre-kickoff line). Messages are
  filtered to `SuperOddsType = 1x2_participant_result` with no
  `MarketPeriod`, preferring StablePrice bookmaker id 10021; prices arrive
  as parallel `PriceNames`/`Prices` arrays in thousandths of decimal odds.
  Polled every 5 minutes pre-kickoff (30 s odds cache); the last
  pre-kickoff line is locked and scored.
- **In-play updates** — the same `GET /api/odds/snapshot/{fixtureId}`,
  re-read on match events (goal, red card, half-time, extra time, shootout)
  and on a ≤12-minute staleness pulse, feeding exhibition (unscored) live
  forecasts.
- **Merkle daily-root commitments on Solana** — the `daily_scores_roots`
  PDA (seed `["daily_scores_roots", epoch_day_le]`) of the TxOracle program,
  devnet `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` (mainnet
  `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`). Verification simulates
  the program's own `validateStat` via Anchor `.view()` — read-only, no
  transaction sent.
- **Scores-validation primitives** —
  `GET /api/scores/stat-validation?fixtureId=…&seq=…&statKey=1002` (key 1002
  is the full-time-score stat) returns `statToProve`, `statProof`,
  `subTreeProof`, `mainTreeProof`. Leaf =
  `sha256(u32le(key) ‖ u32le(value) ‖ u32le(period))`, folded
  leaf → `eventStatRoot` → `eventStatsSubTreeRoot` → daily main root
  (`recomputeRoot` in `lib/txodds.js`; per-match CLI
  `scripts/verify-settlement.js`). `GET /api/scores/snapshot/{fixtureId}`
  supplies the score record and `seq`.

Secondary sources: ESPN public World Cup feed (fixtures and final scores);
OpenRouter (all ten model calls, one identical prompt per match).

## Verify a settlement yourself

1. Open any finished match at https://worldcup.uptick.fyi and tap the green
   **Score verified on Solana** badge.
2. The receipt shows the leaf preimage, each sibling hash, and the computed
   root.
3. Follow the Solscan link to the daily-root commitment on-chain and
   compare — recompute the path independently; if any hash differed, the
   badge would not render.

From a terminal: `node --env-file=.env scripts/verify-settlement.js <matchId>`
prints the leaf preimage, every sibling hash, the recomputed daily root, and
the root committed on Solana, then says VERIFIED/FAILED.

## Solana scope

We use Solana the way TxLINE was designed to be used here: as a
verification and audit layer. Every settlement in the product is checkable
against on-chain roots. No wallets, no asset transfers, no custody — by
design, and in line with the track's architectural guidance that the TxLINE
token is not for end-user transfers.

## Stack

Node/Express on Vercel (one app, served as a serverless function in hosted
mode; the four prompt templates are server-rendered into the page from the
same `buildPrompt` code that makes the real calls) · vanilla-JS client for
interactivity · in-process schedulers plus visit-triggered collection
bounded by database locks (Supabase in hosted mode, `data/store.json`
committed to git as the audit trail) · OpenRouter for model inference ·
TxLINE for market data and on-chain verification.
