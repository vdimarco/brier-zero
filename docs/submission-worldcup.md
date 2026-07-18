# Superteam Earn — World Cup Hackathon submission draft

**Deadline: July 19 (submissions close with the tournament final).**
Tracks: fits **Markets** and **Trading agents**; the live page doubles as a
**Fan experience**.

---

## Project name

**The Brier Cup — eight AIs vs. the betting market**

## One-liner

Eight frontier AI models forecast every FIFA World Cup 2026 match under one
identical prompt — and compete head-to-head against TxODDS's StablePrice
consensus line, de-vigged and Brier-scored on the same leaderboard. Can any
AI beat the market?

## Description

The Brier Cup is a live forecasting tournament that has run all World Cup.
Before every match, eight models (Claude, GPT, DeepSeek, Kimi, GLM, Qwen,
MiniMax, Gemini) receive the exact same prompt and must commit to
probabilities: home/draw/away for the 90-minute result in the group stage,
who-advances in the knockouts. Forecasts lock at kickoff — the git history
of the prediction ledger is a public audit trail proving every forecast
predates the whistle. As results arrive, every forecast is scored with the
multi-category Brier score (0 = perfect, 0.667 = three-way coin flip,
2 = maximally wrong). Lowest average wins.

**The TxODDS integration seats a ninth competitor that never hallucinates:
the market itself.** TxLINE's StablePrice feed — consensus bookmaker odds
aggregated by TxODDS and anchored on Solana — is fetched per fixture,
stripped of its vig (proportional normalization, overround preserved in the
stored record for transparency), locked at kickoff under identical rules,
and Brier-scored on the same leaderboard. During matches, the live line
reprices on the card next to each model's in-play re-forecasts, so you can
watch GPT and the bookmakers react to the same goal in real time.

That turns a fun AI benchmark into a genuine market-efficiency experiment:
the leaderboard is a running, cryptographically-auditable answer to "do
frontier LLMs price football better or worse than the global betting
market?" — with the market's data itself verifiable on-chain via TxLINE's
validation proofs.

## How TxODDS is used

- `lib/txodds.js` — full TxLINE client: guest-JWT + activated-token auth
  with automatic renewal, fixtures snapshot (`competitionId=72`), odds
  snapshots (including `asOf` historical lines for retro backfill), scores
  snapshot, SSE-ready; fixture matching to our match ids by normalized
  team names + kickoff; de-vig math and knockout advance derivation, all
  unit-tested.
- "The Market" is a first-class competitor (`txodds/market`) in the same
  prediction ledger, prompt-transparency page, and leaderboard.
- Live StablePrice odds strip on every active match card.
- One-command on-chain activation: `scripts/txodds-setup.mjs` (Solana
  ed25519 signing via node:crypto — zero new dependencies, key never
  leaves the machine). World Cup free tier: no TxL required.
- The Market is backfilled from TxLINE historical StablePrice odds across
  all **102** played matches (`scripts/backfill.js --only txodds/market`)
  and currently leads the leaderboard (average Brier **0.4262**).
- Resolved scores are verified read-side against TxODDS's on-chain
  `daily_scores_roots` commitment via Anchor `validateStat` simulation
  (`scripts/verify-results.js`). Program id on devnet:
  `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`. Finished match cards
  show a "Score verified on Solana ✓" badge linking the PDA on explorer
  when the proof passes (78 of 102 played matches with a TxLINE
  `game_finalised` score record).

## Links

- Live app: <https://YOUR-DEPLOYMENT.vercel.app>  ← fill in
- Repo: <https://github.com/vdimarco/brier-zero>  ← confirm visibility
- Audit trail: every forecast committed to git before kickoff
- TxLINE docs: <https://txline-docs.txodds.com/documentation/worldcup>

## Demo script (for the video / judges)

1. Open the leaderboard: nine rows — eight AIs and The Market — ranked by
   average Brier. Point at who's beating whom.
2. Open a match card: consensus bar, per-model forecasts, and the live
   TxODDS odds strip with the de-vigged line.
3. Expand a finished match: locked forecasts vs the settled outcome; the
   market's record scored under identical rules.
4. Show the ledger commit history: forecasts provably predate kickoff;
   TxLINE anchors the odds on Solana — both sides of the experiment are
   auditable.

## Honest footnotes (judges appreciate them)

- Knockout advance probabilities derive from the 1X2 line (draw split by
  relative strength) until a to-qualify offer is mapped; the method is
  documented and unit-tested.
- The payload field mapper is written defensively against the documented
  envelope shapes; `scripts/txodds-probe.mjs` verifies the mapping against
  live payloads in seconds.
