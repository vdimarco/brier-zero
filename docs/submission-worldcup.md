# Superteam Earn — World Cup Hackathon submission

**Deadline: July 19, 2026** (submissions close with the tournament final).  
**Track:** **Prediction Markets & Settlement**; the live page also serves as a **Fan experience**.

Use this file as the paste source for Superteam Earn (demo video, app link, technical overview, TxLINE feedback).

---

## Project name

**The Brier Cup — the AI labs vs. the betting market**

## One-liner

AI agents from ten labs forecast and paper-trade every FIFA World Cup 2026 match under one identical prompt — against TxODDS’s StablePrice consensus line, de-vigged, Brier-scored, and bet quarter-Kelly on the same board, with every settlement Merkle-verified on Solana. Can any AI beat the market?

## Description (submission form)

The Brier Cup is a live forecasting tournament that has run the whole World Cup. Before every match, frontier models from ten AI labs (Claude, GPT, DeepSeek, Kimi, GLM, Qwen, MiniMax, Gemini, Grok, Mistral) receive the exact same prompt and commit probabilities: home/draw/away for the 90-minute result in the group stage, who advances in the knockouts. Forecasts lock at kickoff — the git history of the prediction ledger is a public audit trail that every forecast predates the whistle. As results arrive, every forecast is scored with the multi-category Brier score (0 = perfect, 0.667 = three-way coin flip, 2 = maximally wrong). Lowest average wins.

Before the final, each lab’s backtest-winning newest release was substituted into the live roster (with xAI’s Grok 4.5 and Mistral joining at the final). The predecessors’ full-tournament records stay on the board as retired entrants — the default by-lab view folds them into one continuous record per lab — and the ranking metric keeps it honest: rows rank by **shrunken skill vs the coin flip** ((baseline − Brier)/baseline per match, with ten phantom coin-flip matches), so a newcomer starts neutral and earns rank with evidence instead of a lucky two-match sample leapfrogging a 100-match record. Average Brier stays the headline number.

**The TxODDS integration seats one more competitor that never hallucinates: the market itself.** TxLINE’s StablePrice feed — consensus bookmaker odds aggregated by TxODDS and anchored on Solana — is fetched per fixture, stripped of its vig (proportional normalization; overround stored for transparency), locked at kickoff under identical rules, and Brier-scored on the same leaderboard. During matches, the live line can reprice on the card next to each model’s in-play re-forecasts.

That turns a fun AI benchmark into a market-efficiency experiment: the leaderboard is a running, cryptographically auditable answer to “do frontier LLMs price football better or worse than the global betting market?” — with the market’s settled scores themselves verifiable on-chain via TxLINE validation proofs.

**Current result (as of the final's kickoff):** On the knockout board that decides the cup, The Market leads with average Brier **0.312** over **31** scored matches, ahead of all ten labs (best agent: Claude Opus 4.7 at 0.322). On the paper-trading Bankroll — 1,361 quarter-Kelly bets settled across all 103 matches — **MiniMax leads at 1,566 units from 1,000**, despite ranking near the bottom on calibration. Headline for judges: **no AI beat the bookies on calibration; variance, not skill, made the richest agent.**

## How TxODDS / TxLINE is used

| Capability | Implementation | TxLINE surface |
|---|---|---|
| Fixtures → ESPN match mapping | `lib/txodds.js` `fetchFixtures`, `matchFixture` | `GET /api/fixtures/snapshot?competitionId=72` |
| Pre-kickoff + historical odds | `marketProbs` / backfill `asOf` kickoff | `GET /api/odds/snapshot/{fixtureId}` (`?asOf=` ms) |
| Live odds strip on match cards | `lib/feed.js` enrichment | Same odds snapshot |
| Scores for proof selection | `fetchScoresSnapshot` | `GET /api/scores/snapshot/{fixtureId}` (+ stream available) |
| Merkle score verification | `recomputeRoot`, `scripts/verify-results.js` | `GET /api/scores/stat-validation` + Solana `daily_scores_roots` PDA |
| Free-tier auth | Guest JWT + activated token | `/auth/guest/*`, `/api/token/activate`, on-chain subscribe |

- Entrant id: **`txodds/market`** (“The Market”) — same ledger and leaderboard as every model.
- Attribution in UI: **“TxODDS StablePrice · TxLINE on Solana”** on the leaderboard row, detail panel, and live-odds strip.
- Full-tournament backfill: `scripts/backfill.js --only txodds/market` → **102/102** played matches scored.
- Read-side proof verification (no txs sent): **78/102** finished matches with a TxLINE `game_finalised` score record show **“Score verified on Solana ✓”** linking the PDA on Solana Explorer (devnet program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`).
- Docs: `docs/txodds-integration.md`. Design/plan: `docs/superpowers/specs/2026-07-17-txline-market-entrant-design.md`.

## Links (paste into Superteam)

| Field | Value |
|---|---|
| **Live app** | https://worldcup.uptick.fyi |
| **Research / knockout write-up** | https://worldcup.uptick.fyi/research |
| **Repo** | https://github.com/vdimarco/brier-zero |
| **TxLINE World Cup docs** | https://txline-docs.txodds.com/documentation/worldcup |
| **TxODDS** | https://txodds.net/ |

> **Judges access checklist**
> 1. App is public at worldcup.uptick.fyi (Vercel production).
> 2. Repo is **public** (MIT-licensed) at https://github.com/vdimarco/brier-zero. ✓
> 3. For live odds on production (not only backfilled leaderboard rows), set Vercel env: `TXODDS_API_TOKEN`, `TXODDS_ENV` (see `docs/txodds-integration.md`). Historical market Brier scores and Solana badges work from the committed ledger without runtime TxLINE calls.

## Demo script (≤5 min video)

1. **Open** https://worldcup.uptick.fyi — hero states the experiment: ten AI agents trading the World Cup against the market on Solana; podium carousel cycles Brier and Bankroll by country / lab / model.
2. **The Bankroll** — the race chart, an agent's bet ledger, and a settled bet's **✓** opening the Merkle settlement receipt. Then the **Leaderboard**: The Market leading the knockout board (avg Brier 0.312, +39.1% vs the coin flip over 31 matches), slug *TxODDS StablePrice · TxLINE on Solana*; flip **By lab / By model / By country**.
3. **Expand a finished match** — locked forecasts vs outcome; show **Score verified on Solana ✓** and open the explorer PDA link.
4. **Match card / live path** — if a match is upcoming or in-play and the API token is configured, show the **Live odds · TxODDS on Solana** strip next to model forecasts.
5. **Audit trail** — mention forecasts committed to git before kickoff; odds/scores anchored via TxLINE; proofs recomputed client-side against the on-chain root.
6. **Optional:** `/research` for knockout narrative (France–Spain, England–Argentina).

## Brief technical documentation

### Core idea

Same prompt → many models → Brier score vs real results, with the **bookmaker consensus as an entrant** so the leaderboard answers a real market question, not only “which LLM is least bad.”

### Stack

- Node 18+ ESM, Express (local) / Vercel serverless (`api/index.js`)
- Frontend: static `public/` (no build step)
- Data: ESPN public feed for fixtures/scores; TxLINE for odds + proofs
- Solana: `@solana/web3.js` + Anchor IDL read-side only (`data/idl/txoracle.json`)
- Tests: `npm test` → 42 unit tests (odds parse, de-vig, fixture match, Merkle recompute, Brier scoring, backfill `--only`)

### TxLINE endpoints used

```
POST  /auth/guest/start          (guest JWT)
POST  /api/token/activate        (one-time, wallet-signed)
GET   /api/fixtures/snapshot     competitionId=72
GET   /api/odds/snapshot/:id     optional ?asOf=<ms>
GET   /api/scores/snapshot/:id
GET   /api/scores/stat-validation?fixtureId=&seq=&statKey=
```

Env: `TXODDS_API_TOKEN`, `TXODDS_ENV=devnet|mainnet`, optional `TXODDS_COMPETITION_ID`, `TXODDS_API_ORIGIN`, `SOLANA_RPC_URL`.

### Business / product highlights

- **Honest experiment design:** identical prompts, lock-at-kickoff, multi-category Brier — market and models under the same rules.
- **Sponsor depth:** not a thin API demo — full historical StablePrice backfill, de-vig math, fixture mapping, and on-chain root verification.
- **Fan-facing UI:** leaderboard, match cards, trophy/knockout bracket, research narrative, Solana verification badges.
- **Result that sells:** market beats every model on 102 matches.

### Honest footnotes

- Knockout advance probs derive from the 1X2 line (draw mass split by relative strength) until a to-qualify offer is mapped; method is unit-tested.
- Proof badges require a TxLINE final-score record; **78 of 102** finished matches currently verify (not every ESPN FT has a matching `game_finalised` sequence on the free tier).
- Market forecasts in the ledger are **retro-priced** at pre-kickoff (`asOf`) for historical coverage and labeled as backtest in the UI pattern shared with other retro rows.
- Production may run with TxLINE unconfigured for visitors; leaderboard + badges still load from the committed store. Set the token on Vercel for live odds enrichment.

## TxLINE API feedback (required on form)

**Liked most**

- Free World Cup tier with real StablePrice history via `asOf` — enough to run a full-tournament market entrant without paying for data.
- Guest JWT + `X-Api-Token` model is clean once activated; on-chain free-tier subscribe + signed activate is a solid Solana story for judges.
- Stat-validation payloads are rich enough to recompute Merkle roots and compare to `daily_scores_roots` without submitting txs.

**Friction**

- **Devnet faucet / empty odds surprises:** first probes returned no odds until we fixed client bugs (`asOf` must be **milliseconds**, not seconds; 1X2 arrives as parallel `PriceNames`/`Prices` thousandths arrays; activation token is **plain text**, not JSON).
- **Fixtures window:** snapshot default ranges missed older group-stage matches until we widened lookup to the `asOf` date.
- **Coverage gaps for proofs:** not every finished ESPN match had a usable final score sequence for `statKey=1002` on devnet (78/102).
- **Public faucet rate limits** made scripted wallet funding painful; browser faucet + GitHub login was more reliable than CLI airdrop.

## Ready-to-paste short answers

**What problem does this solve?**  
Nobody knows if frontier LLMs price sports better than the market. We run both under identical scoring and show the answer live.

**What did you build?**  
A public World Cup arena where agents from ten AI labs forecast and paper-trade every match against TxODDS StablePrice on Solana — lock-at-kickoff forecasts, a quarter-Kelly bet ledger, and every settlement Merkle-verified on-chain: a receipt, not a claim.

**What should judges click?**  
1) **The Bankroll** (top of page) — the race chart, then any agent's row for its full bet ledger; tap a **✓** on a settled bet for the Merkle settlement receipt. 2) Any finished match's green **"Score verified on Solana"** badge → the audit-trail modal → Solscan. 3) The **podium carousel** (Brier and Bankroll, by country / lab / model) and the **Edge Board**. 4) Terminal proof: `node --env-file=.env scripts/verify-settlement.js <matchId>` prints leaf → siblings → recomputed root vs the on-chain root. 5) Optional `/research`.
