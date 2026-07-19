# The Brier Cup — can any AI beat the betting market?

> **Live at [worldcup.uptick.fyi](https://worldcup.uptick.fyi)** ·
> [**▶ video walkthrough**](https://www.youtube.com/watch?v=ZpJF2fzk8tw) ·
> World Cup hackathon entry (Superteam × TxODDS, **Prediction Markets &
> Settlement** track) · submission notes:
> [`docs/submission-worldcup.md`](docs/submission-worldcup.md) · TxLINE setup:
> [`docs/txodds-integration.md`](docs/txodds-integration.md)

Ten AI trading agents bet the FIFA World Cup 2026 against the real market.
Each agent — a frontier model from one of ten labs (Claude, GPT, DeepSeek,
Kimi, GLM, Qwen, MiniMax, Gemini, Grok, Mistral) — gets one identical prompt per
match, commits to probabilities, and paper-trades quarter-Kelly bets against
**TxODDS StablePrice** consensus odds streamed by
[**TxLINE** on Solana](https://txline-docs.txodds.com): every trade locked
pre-kickoff, fully ledgered, and settled against results **Merkle-verified
against TxODDS's on-chain daily root**. The market itself competes too — the
de-vigged StablePrice line is an entrant, scored on the exact same Brier
rules.

Group-stage matches price the 90-minute result (home win, draw, away win);
knockout matches price who advances — two outcomes, extra time and penalties
included, no draw. Forecasts lock at kickoff. As real results arrive, every
forecast is scored with the multi-category
[Brier score](https://en.wikipedia.org/wiki/Brier_score): 0 is a perfect
forecast (hence the repo name), a know-nothing coin flip scores 0.667 on a
three-way group match and 0.5 on a two-way knockout tie, 2 is maximally
wrong. Lowest average wins.

**The answer so far: no.** Over 100+ scored matches, The Market leads the
board and no AI model has beaten it.

## How it works

- **Fixtures and live scores** come from ESPN's public World Cup scoreboard
  feed. No key needed. The page polls it and tightens to a 12-second refresh
  while a match is live.
- **The Market (TxODDS)**: with TxLINE credentials configured, every match
  card shows the live StablePrice line, and "The Market" trades on the
  leaderboard as a competitor — its forecast is the de-vigged implied
  probability from consensus bookmaker odds, locked at kickoff like everyone
  else's. Knockout advance probabilities derive from the 1X2 line with the
  draw split by relative strength (documented and unit-tested in
  `lib/txodds.js`). Finished matches carry a **"Score verified on Solana ✓"**
  badge when the final score Merkle-proves against the root TxODDS committed
  on-chain (`scripts/verify-results.js`). Setup: `docs/txodds-integration.md`.
- **Forecasts** are collected through [OpenRouter](https://openrouter.ai), so
  one API key covers the whole roster. Every model receives the exact same
  prompt and must answer with JSON probabilities that sum to 1.
- **Two markets**: group-stage matches ask for the 90-minute result
  (home/draw/away; extra time and penalties count as a draw). Knockout
  matches ask one thing only: who advances (home/away). Each stored forecast
  is stamped with the market it priced, so knockout forecasts collected under
  the old 90-minute market still settle against the 90-minute result.
- **Locking**: only forecasts stored before kickoff are eligible for scoring.
  Anything collected late is shown but excluded from the leaderboard.
- **In-play updates**: while a match is live, the server re-forecasts with
  every model after every event — goal, red card, kickoff, half-time, extra
  time, a shootout starting — plus a pulse every 10 quiet minutes. These
  snapshots are exhibition only and never touch the locked, scored forecasts.

## Run it

```bash
npm install
cp .env.example .env        # add your OPENROUTER_API_KEY
                            # + TXODDS_API_TOKEN to seat "The Market"
OPENROUTER_API_KEY=sk-or-... npm start
# open http://localhost:3000
```

### Runs itself

While the server runs it automatically collects forecasts for upcoming matches
every 5 minutes, so the "in advance" part takes care of itself; in hosted mode
any page visit keeps the ledger current, bounded by database locks. You can
also:

```bash
npm run predict              # one-shot: collect forecasts for all upcoming matches
DEMO_MODE=1 npm start        # no key: deterministic placeholder forecasts, clearly flagged
npm test                     # scoring, locking, parsing, and de-vig unit tests
```

## The roster, substitutions, and ranking integrity

Edit `models.config.json`. Any OpenRouter model slug works. The leaderboard is
keyed by slug, so changing a slug starts a fresh record for that entry —
retired slugs belong in the config's `retired` list, which keeps their full
records on the leaderboard and their forecasts rendering on every match they
priced.

Before the final, each lab's newest release was substituted into the live
roster (and xAI's Grok joined as a ninth lab); the predecessors' 100+-match
records stay on the board as retired entrants. The default **by-lab view**
folds each lab's members into one continuous record (the active member's
forecast is the lab's official entry when both priced the same match); the
**by-model view** shows every entrant separately.

**Ranking metric:** average Brier is the headline number, but rank comes from
**shrunken skill vs the coin flip**. Each match scores
`(baseline − Brier) / baseline` — 0 is know-nothing, 1 is perfect, negative is
worse than guessing — which normalizes match difficulty and makes group
(baseline ⅔) and knockout (½) records commensurable. Every entrant then
carries ten phantom coin-flip matches (`Σskill / (n + 10)`), so a newcomer
starts at exactly neutral and earns rank as real matches accumulate: models
can join at any point and be compared immediately, without a lucky two-match
sample leapfrogging a hundred-match record and without any eligibility
cliff.

## API

| Route | What it does |
|---|---|
| `GET /api/state` | Matches, forecasts, and leaderboard in one payload |
| `POST /api/predict` | Collect forecasts now (`{"matchId": "..."}` optional) |
| `GET /api/health` | Liveness check |

## Audit trail

Predictions are stored in `data/store.json` (or Supabase in hosted mode) and
committed to the repository: the git history is the audit trail proving every
forecast predates its kickoff. Matches whose teams are still bracket
placeholders ("Quarterfinal 1 Winner") are held back until both teams are
decided, and every forecast is stamped with the fixture it priced so it can
never score against different teams. Where TxLINE publishes a final-score
record, the score is Merkle-proved against the `daily_scores_roots` PDA on
Solana and badged on the match card.

### Verify a settlement yourself

1. Open [worldcup.uptick.fyi](https://worldcup.uptick.fyi) and find any
   finished match with the green **"Score verified on Solana ✓"** badge.
2. Tap the badge (or the **✓** on any settled bet-ledger row): the
   **Settlement audit trail** receipt opens — the settled
   outcome, the leaf identity (TxODDS full-time-score stat, key 1002), the
   recomputed daily root, and the on-chain root they must equal.
3. Follow **Open on Solscan** (or Solana Explorer) to the
   `daily_scores_roots` account and compare the committed root for that epoch
   day with the one in the receipt. If any hash differed, the badge would not
   show.
4. For one match from the terminal:
   `node --env-file=.env scripts/verify-settlement.js <matchId>` prints the
   leaf preimage, every sibling hash in the Merkle path, the recomputed
   daily root, and the root committed on Solana, then says
   VERIFIED/FAILED.
5. To reproduce everything from scratch: `node scripts/verify-results.js`
   re-fetches the stat-validation payload for every finished match, folds
   the Merkle path locally (`recomputeRoot`), and simulates on-chain
   `validateStat` — no transaction is sent.

## Architecture: how an agent's bet settles

1. **Stream** — TxLINE on Solana streams TxODDS StablePrice consensus odds
   for every fixture (`lib/txodds.js`).
2. **De-vig** — the bookmaker margin is stripped, leaving implied
   probabilities; this is The Market's forecast.
3. **Lock at kickoff** — forecasts, lines, and stakes are frozen; nothing
   collected after kickoff ever counts (`lib/predictor.js`, ledger commits).
4. **Result** — the final score arrives from ESPN's public feed
   (`lib/espn.js` / `lib/feed.js`).
5. **Merkle proof** — the score is verified against TxODDS's on-chain daily
   root: leaf → statProof → eventStatRoot → subTreeProof → mainTreeProof →
   `daily_scores_roots` PDA, simulated via the program's `validateStat`
   (`scripts/verify-results.js`, `recomputeRoot` in `lib/txodds.js`).
6. **Settle** — bet P&L settles at the locked line (`lib/bankroll.js`) and
   the Brier score updates the leaderboard (`lib/scoring.js`), both from the
   verified result.


## Solana scope

Honest boundaries: Solana is the **verification layer**, not the trading
venue. TxLINE delivers TxODDS StablePrice odds and commits Merkle daily
roots of settled scores to the `daily_scores_roots` PDA; this project reads
those roots (devnet) and proves each final score against them —
`validateStat` is simulated read-only, no transaction is sent and no funds
move. Betting is paper-only with virtual units. What the chain buys us is
tamper-evidence: the settlement record every score and every bet resolves
against cannot be quietly edited after the fact.

## The Bankroll: paper-trading rules

Every agent paper-trades its locked forecasts against the locked TxODDS
line. **Virtual units only — no real money anywhere.** The whole ledger is a
deterministic pure fold over `(locked forecasts, locked lines, settled
results)` in match order — no randomness, no wall clock — so it is exactly
reproducible (`node scripts/bankroll.js`; run twice, byte-identical output).

- **Starting bankroll:** 1,000 units per model, at its first scored match.
- **Odds used:** raw TxODDS StablePrice decimal odds (vig included) for
  1X2 bets — the honest version, the model must beat the vig.
  Knockout "who advances" bets settle at fair (de-vigged) odds `d = 1/q`,
  since no single advances price is quoted; disclosed in the UI.
- **Which market a bet is in:** the one the forecast priced — the same rule
  the leaderboard scores by. A 90-minute 1X2 forecast placed on a knockout
  fixture is still a 1X2 bet on the raw line, settled by the 90-minute
  result; an advance forecast settles the two-way advance market. So every
  model has a decision row (bet or no-bet) on all 103 settled matches.
- **Edge per outcome:** `edge_o = p_o · d_o − 1`.
- **Bet selection:** one bet per match per model, on the outcome with the
  maximum edge, only if `edge > 0.02` (2% threshold). Otherwise the model
  sits out that match (recorded as a "no bet").
- **Stake — fractional Kelly:** full Kelly `f* = (p·d − 1)/(d − 1)`;
  stake = `0.25 · f* · bankroll` (quarter-Kelly), capped at
  `0.10 · bankroll`. Stakes below 0.5 units floor to zero (no dust bets).
- **Settlement:** on the same result event that triggers Brier scoring.
  Win → `bankroll += stake·(d−1)`; loss → `bankroll −= stake`. 1X2 bets
  settle the 90-minute result (draw is a real outcome); advance bets
  settle "who advances" (two outcomes, no draw).
- **Lock discipline:** identical to forecasts — only the pre-kickoff locked
  probability and pre-kickoff line count. In-play numbers never bet.
- **The Market as competitor:** excluded — it can't bet against itself
  (zero edge at its own odds by construction).

---

---

## The Brier Zero library

This repo also houses **Brier Zero**, the Python map/territory detection
engine the site is named after — probes, calibration scoring, and the
library sketch live in [`docs/LIBRARY.md`](docs/LIBRARY.md).

## License

[MIT](LICENSE). The code only: stored market records are TxODDS's data and
match scores are ESPN's — this license grants no rights to either.
