# The Brier Cup — can any AI beat the betting market?

> **Live at [worldcup.uptick.fyi](https://worldcup.uptick.fyi)** · World Cup
> hackathon entry (Superteam Earn, TxODDS track) · submission notes:
> [`docs/submission-worldcup.md`](docs/submission-worldcup.md) · TxLINE setup:
> [`docs/txodds-integration.md`](docs/txodds-integration.md)

Frontier AI models from nine labs (Claude, GPT, DeepSeek, Kimi, GLM, Qwen,
MiniMax, Gemini, Grok) get one identical prompt before each FIFA World Cup
2026 match and must commit to probabilities — and they all compete against an
entrant that never hallucinates: **the betting market itself**, via
[TxODDS TxLINE](https://txline-docs.txodds.com), de-vigged StablePrice
consensus odds delivered over Solana and scored on the exact same Brier
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

While the server runs it automatically collects forecasts for upcoming matches
every 5 minutes, so the "in advance" part takes care of itself. You can also:

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

## Architecture: how a match gets settled

1. **Stream** — TxLINE on Solana streams TxODDS StablePrice consensus odds
   for every fixture (`lib/txodds.js`).
2. **De-vig** — the bookmaker margin is stripped, leaving implied
   probabilities; this is The Market's forecast.
3. **Lock at kickoff** — every model and the market are frozen; nothing
   collected after kickoff ever counts (`lib/predictor.js`, ledger commits).
4. **Result** — the final score arrives from ESPN's public feed
   (`lib/espn.js` / `lib/feed.js`).
5. **Merkle proof** — the score is verified against TxODDS's on-chain daily
   root: leaf → statProof → eventStatRoot → subTreeProof → mainTreeProof →
   `daily_scores_roots` PDA, simulated via the program's `validateStat`
   (`scripts/verify-results.js`, `recomputeRoot` in `lib/txodds.js`).
6. **Score & settle** — Brier scores update the leaderboard
   (`lib/scoring.js`) and the paper-trading bankroll settles at the locked
   line (`lib/bankroll.js`).

## Verify a settlement yourself

1. Open [worldcup.uptick.fyi](https://worldcup.uptick.fyi) and find any
   finished match with the green **"Score verified on Solana ✓"** badge.
2. Tap the badge: the **Settlement proof** receipt opens — the settled
   outcome, the leaf identity (TxODDS full-time-score stat, key 1002), the
   recomputed daily root, and the on-chain root they must equal.
3. Follow **Open on Solscan** (or Solana Explorer) to the
   `daily_scores_roots` account and compare the committed root for that epoch
   day with the one in the receipt. If any hash differed, the badge would not
   show.
4. To reproduce from scratch: `node scripts/verify-results.js` re-fetches the
   stat-validation payload for every finished match, folds the Merkle path
   locally (`recomputeRoot`), and simulates on-chain `validateStat` — no
   transaction is sent.

## The Bankroll: paper-trading rules

Every model paper-trades its locked forecasts against the locked TxODDS
line. **Virtual units only — no real money anywhere.** The whole ledger is a
deterministic pure fold over `(locked forecasts, locked lines, settled
results)` in match order — no randomness, no wall clock — so it is exactly
reproducible (`node scripts/bankroll.js`; run twice, byte-identical output).

- **Starting bankroll:** 1,000 units per model, at its first scored match.
- **Odds used:** raw TxODDS StablePrice decimal odds (vig included) for
  group-stage 1X2 bets — the honest version, the model must beat the vig.
  Knockout "who advances" bets settle at fair (de-vigged) odds `d = 1/q`,
  since no single advances price is quoted; disclosed in the UI.
- **Edge per outcome:** `edge_o = p_o · d_o − 1`.
- **Bet selection:** one bet per match per model, on the outcome with the
  maximum edge, only if `edge > 0.02` (2% threshold). Otherwise the model
  sits out that match (recorded as a "no bet").
- **Stake — fractional Kelly:** full Kelly `f* = (p·d − 1)/(d − 1)`;
  stake = `0.25 · f* · bankroll` (quarter-Kelly), capped at
  `0.10 · bankroll`. Stakes below 0.5 units floor to zero (no dust bets).
- **Settlement:** on the same result event that triggers Brier scoring.
  Win → `bankroll += stake·(d−1)`; loss → `bankroll −= stake`. Group stage
  settles the 1X2 90-minute result (draw is a real outcome); knockouts
  settle "who advances" (two outcomes, no draw).
- **Lock discipline:** identical to forecasts — only the pre-kickoff locked
  probability and pre-kickoff line count. In-play numbers never bet.
- **The Market as competitor:** excluded — it can't bet against itself
  (zero edge at its own odds by construction).

---

# Brier Zero: the Map/Territory Detection Engine

The original engine this repo is named for — an agent-only prediction market
that produces self-contained, interactive HTML intelligence artifacts, detects
where an organization's internal map (roadmaps, dashboards, official
narratives) diverges from the territory (ground truth, employee knowledge,
market reality), and audits its own research skills after every resolution.

> Weak teams fail loudly. Strong teams fail quietly, propagating bad
> assumptions across multi-quarter plans. The map is never inspected against
> the territory until it is too late.

See [PRD v2.0](https://linear.app/0x56/document/prd-v20-brier-zero-mapterritory-engine-df298f12b710)
for the full product spec.

## How it works

1. **A human creates a market**: a question, resolution criteria, a close date,
   and optionally the *official map* (what the dashboard/roadmap claims).
2. **Restatement gate (BZ-102)**: before the market opens, the research agent
   must restate the question and surface its load-bearing assumptions. If a
   surfaced assumption surprises the creator — or the creator corrects the
   restatement — the market is flagged **high map/territory risk** and a gap
   alert is recorded. A surprised founder is a gap detected early.
3. **Agents trade** (humans never do): research agents score source
   credibility, pool evidence into a probability, and place trades. Price is a
   reputation-weighted aggregate.
4. **Employees whisper (BZ-201)**: SSO-verified employees guide a proxy agent
   with natural-language whispers. The proxy converts them into bounded,
   pseudonymous probability signals — HMAC pseudonyms are stable within a
   market but unlinkable across markets. The market gets the signal; the
   journalist doesn't get the leak.
5. **The meta layer (BZ-301)**: every reprice recomputes the **Map Fidelity
   Score** (0–100) — where the map is silent, contradicted, or stale — and a
   >30% price/map divergence auto-generates a Map/Territory Gap Analysis.
   Displayed confidence is widened proportionally to lost fidelity: a
   confident agent with a bad map is dangerous.
6. **Resolution & meta-calibration (BZ-302)**: Brier scores update agent
   reputation and feed the skill audit pipeline, which flags "dead weight"
   research skills and down-weights them for future markets.

Every output is an **artifact, not a conversation** (BZ-101/103/202): a single
HTML file with 4-layer progressive disclosure (executive summary → chart &
signals → full reasoning & hover-to-verify sources → raw data & audit trail),
plus a structured `market-agent.md` for the next agent session.

## Quick start

```bash
# no dependencies beyond Python 3.10+
PYTHONPATH=src python3 -m brier_zero.demo dist
open dist/market-human.html      # the flagship artifact
open dist/index.html             # landing page A/B router (BZ-303)
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests   # run tests
```

## Library sketch

```python
from brier_zero import (MarketEngine, Question, OfficialMap, ResearchAgent,
                        EvidenceItem, Source, EmployeeDirectory,
                        EmployeeProxyAgent, Whisper)

engine = MarketEngine()
market = engine.create_market(
    Question(text="Will X ship by 2028?",
             resolution_criteria="Resolves YES if a production unit ships.",
             close_at=close_date),
    OfficialMap(text="Dashboard: on track.", claimed_probability=0.9),
)
engine.run_restatement(market)                     # BZ-102 gate
engine.review_restatement(market, verdicts)        # creator reviews assumptions

agent = ResearchAgent("skeptic", skill_ids=["skill_supply_chain"])
engine.place_trade(market, agent.trade(agent.assess(evidence)))

proxy = EmployeeProxyAgent(EmployeeDirectory(tokens=sso_tokens), secret=key)
draft = proxy.draft(Whisper(employee_token=tok, text="thermal failed twice", market_id=market.id))
engine.apply_signal(market, draft.signal)          # bounded ±15% nudge

engine.close(market)
audit = engine.resolve(market, outcome=False)      # Brier scoring + skill audit
```

## Repository layout

```
src/brier_zero/
  models.py       domain objects (Market, Question, OfficialMap, Signal, …)
  engine.py       market lifecycle: restatement gate → trading → resolution
  scoring.py      Brier score, difficulty-adjusted Brier Index, leaderboard
  restatement.py  BZ-102 restatement protocol (pluggable restater)
  fidelity.py     BZ-301 map fidelity scoring + variance band
  research.py     research agent: source credibility, evidence pooling
  proxy.py        BZ-201 employee proxy: SSO verify → pseudonymous signal
  audit.py        BZ-302 post-resolution skill audit pipeline
  artifacts/      BZ-101/103/202/303 self-contained HTML renderers + landing
  demo.py         end-to-end demo market ("Will Apple ship a car by 2028?")
tests/            unittest suite (no external deps)
```

## Design constraints

- **Agent-only trading.** No human trades, no payouts, no gambling surface —
  Brier score is a research metric.
- **Self-contained artifacts.** No CDN, no backend, no login; inline CSS/JS;
  works as an email attachment.
- **Pluggable intelligence.** The heuristic restater / whisper interpreter /
  evidence assessor are deterministic baselines behind small interfaces —
  swap in LLM-backed implementations without touching the engine.
- **Stdlib only.** The core has zero runtime dependencies.

## License

TBD (will be a FOSS license; tracked in 0X5-6).
