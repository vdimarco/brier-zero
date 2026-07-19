# The Brier Cup — technical notes

Submission for the Superteam × TxODDS World Cup hackathon, **Prediction
Markets & Settlement** track. Live at
[worldcup.uptick.fyi](https://worldcup.uptick.fyi).

The product story is settlement: every forecast is locked before kickoff,
every result is verified against TxODDS's Merkle daily root on Solana, and
every downstream number — Brier scores, leaderboard rank, paper-trading
P&L — is recomputed from those verified results by pure, deterministic
code. A settled match produces **a receipt, not a claim**: no external
oracle to trust.

## Endpoints

| Route | Source | What it does |
|---|---|---|
| `GET /api/state` | [`server.js`](../server.js) | Matches, locked forecasts, leaderboards, bankroll — one payload, everything derived on read |
| `POST /api/predict` | [`server.js`](../server.js) | Collect forecasts now (`{"matchId": "..."}` optional) |
| `GET /api/health` | [`server.js`](../server.js) | Liveness check |

Hosted mode runs the same app as a Vercel function ([`api/index.js`](../api/index.js));
self-collection triggers from page visits, bounded by database locks.

## Settlement pipeline

1. **Stream** — TxODDS StablePrice consensus odds over TxLINE on Solana
   ([`lib/txodds.js`](../lib/txodds.js)).
2. **De-vig** — bookmaker margin stripped to implied probabilities; this
   is The Market's forecast.
3. **Lock at kickoff** — forecasts, lines, and stakes frozen
   ([`lib/predictor.js`](../lib/predictor.js), ledger commits).
4. **Result** — final score from ESPN's public feed
   ([`lib/espn.js`](../lib/espn.js), [`lib/feed.js`](../lib/feed.js)).
5. **Merkle proof** — score verified against TxODDS's on-chain daily root:
   leaf → statProof → eventStatRoot → subTreeProof → mainTreeProof →
   `daily_scores_roots` PDA, simulated via the program's `validateStat`
   ([`scripts/verify-results.js`](../scripts/verify-results.js),
   `recomputeRoot` in [`lib/txodds.js`](../lib/txodds.js)). Per-match CLI:
   [`scripts/verify-settlement.js`](../scripts/verify-settlement.js).
6. **Settle** — bet P&L at the locked line
   ([`lib/bankroll.js`](../lib/bankroll.js)) and Brier scores
   ([`lib/scoring.js`](../lib/scoring.js)) update from the verified result.

## Check gates

A forecast only scores (and only bets) after passing every gate:

- **Fixture gate** — each stored forecast is stamped with the fixture it
  priced (`fixtureMatches`, [`lib/scoring.js`](../lib/scoring.js)); a
  bracket re-pairing can never score a forecast against different teams.
- **Lock gate** — only pre-kickoff records are eligible; in-play snapshots
  are exhibition-only and never touch scoring or bets.
- **Market gate** — group forecasts settle 1X2, knockout forecasts settle
  who-advances; each record carries the market it priced.
- **Verification gate** — where TxLINE publishes a final-score record, the
  score Merkle-proves against the on-chain daily root before it is badged.

## Deterministic fold

The Bankroll ([`lib/bankroll.js`](../lib/bankroll.js)) is a **deterministic
fold** over `(locked forecasts, locked lines, settled results)` in kickoff
order — no randomness, no wall clock. `node scripts/bankroll.js` run twice
produces byte-identical output, which is what makes 840 bets auditable row
by row. The same fold runs on every `/api/state` read, so the site and the
backfill can never disagree.

## Audit trail

Forecasts live in `data/store.json` (Supabase in hosted mode) and are
committed to the repository: git history proves every forecast predates
its kickoff. The receipt modal on every verified match shows the leaf,
recomputed root, and the on-chain root, with Solscan/Explorer links to the
`daily_scores_roots` account.
