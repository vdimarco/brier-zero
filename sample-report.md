```
┌──────────────────────────────────────────────────────────────────────┐
│  BRIER // ZERO          BENCHMARK REPORT · SEASON 1 · 2026-07-31     │
└──────────────────────────────────────────────────────────────────────┘
```

# Five frontier models, one market, 1,514 decisions

**This is a real run, not a mock.** Every number below is recomputed from
`data/store.json` and `data/backtests/bankroll.json` in the public
[brier-zero](https://github.com/vdimarco/brier-zero) repository. Each forecast
was committed to git before the event it priced, and 80 of the settlements are
Merkle-proved against the TxODDS daily root on Solana.

**The five benchmarked:** Claude Opus 4.7 · GPT-5.1 · Gemini 3.1 Pro ·
DeepSeek V4 Pro · Qwen 3.7 Max — all publicly available through OpenRouter,
all receiving one identical prompt per question. Ten more entrants and the
de-vigged market line ran alongside them as controls.

---

## The finding

> **All fifteen entrants were overconfident on the outcomes they chose to act
> on, in the same direction, and how overconfident each one was predicts almost
> exactly how much money it lost.**

Across 1,514 staked decisions, the field assigned an average **32.1%**
probability to the outcomes it backed. Those outcomes came in **23.3%** of the
time — a gap of **+8.8 points**, with no entrant on the other side of zero.

Rank the fifteen by that gap and you have very nearly reproduced the P&L table:
**Spearman −0.90, Pearson −0.85** between overconfidence gap and final bankroll.

The shape matters more than the size. On their *modal* pick — the outcome they
called most likely — these models are **underconfident**: Claude Opus 4.7 said
62.4% on average and was right 70.7% of the time. The error is not a uniform
inflation of confidence. It is concentrated precisely in the low-probability
outcomes a model talks itself into acting on, which is the only region where a
decision costs anything. The market line, by contrast, is close to calibrated
throughout (top-pick gap −0.023).

An accuracy eval would score these models as broadly sensible. A price scored
ten of them into a loss.

---

## Standings

Brier score over locked, pre-resolution forecasts. Lower is better; 0.667 is a
coin flip on a three-way question, 0.5 on a two-way.

| Rank | Entrant | Forecasts | Avg Brier | Skill | Final bankroll |
|---|---|---|---|---|---|
| 1 | **The Market** *(control)* | 99 | **0.4271** | **0.2861** | — |
| 2 | **Claude Opus 4.7** | 99 | 0.4376 | 0.2695 | **1,101.59** |
| 4 | **Gemini 3.1 Pro** | 99 | 0.4503 | 0.2493 | 727.88 |
| 5 | **DeepSeek V4 Pro** | 99 | 0.4501 | 0.2474 | 871.62 |
| 9 | **GPT-5.1** | 93 | 0.4825 | 0.2348 | 606.51 |
| 12 | **Qwen 3.7 Max** | 99 | 0.4671 | 0.2235 | 344.55 |
| | *field median (15 AI entrants)* | | 0.4671 | 0.2348 | 727.88 |

Ranks are out of 16 scored entrants. **No AI entrant beat the market**, over
roughly 100 questions each.

---

## Claude Opus 4.7 — full report page

**Anthropic** · 99 forecasts scored · World Cup 2026, two markets

### Verdict

> **The best-calibrated AI entrant on the board, and still second to the market
> — but it is the only model in this five whose overconfidence is small enough
> that its edge survives the vig.**

It finished #2 of 16 on Brier, #3 of 15 on money, and it is one of five entrants
out of fifteen to end above its starting bankroll. Its overconfidence gap
(+0.054) is 40% below the field's. That combination — not raw accuracy — is what
separates it from GPT-5.1, which sits eight places lower on money with a
materially similar Brier score.

### Where it finished

| | Claude Opus 4.7 | Field median | The Market |
|---|---|---|---|
| Rank | **2 of 16** | — | 1 |
| Average Brier | **0.4376** | 0.4671 | 0.4271 |
| Skill vs. coin-flip | **0.2695** | 0.2348 | 0.2861 |
| Forecasts scored | 99 | — | 99 |

By question type:

| | Claude Opus 4.7 | The Market |
|---|---|---|
| Two-way ("who advances"), n=30 | 0.3089 | 0.2928 |
| Three-way (90-minute result), n=69 | 0.4936 | 0.4855 |

It trails the market by a near-constant margin in both markets — 0.016 and
0.008. It is not being beaten in one regime and compensating in another; it is
uniformly, slightly behind.

### Calibration — the number that predicts money

| | Claude Opus 4.7 | Field |
|---|---|---|
| Mean probability assigned to acted-on outcomes | 33.7% | 32.1% |
| How often those outcomes happened | **28.3%** | 23.3% |
| **Overconfidence gap** | **+0.054** | +0.088 |
| Confidence on its modal pick | 62.4% | — |
| How often the modal pick was right | **70.7%** | — |

The two rows point in opposite directions and that is the whole finding for this
model: **underconfident by 8.3 points where it is obviously right, overconfident
by 5.4 points where it decides to act.** For a decision-maker, only the second
number is expensive.

### What it would have done to a bankroll

Quarter-Kelly against the raw market line, vig included. 1,000 units at first
scored event. **Virtual units only — no real money anywhere.**

| | |
|---|---|
| Final bankroll | **1,101.59** (+10.2%) |
| Bets placed / sat out | 99 / 4 |
| Hit rate | 28.3% |
| Best call | CUW @ ECU **+350.43** |
| Worst call | AUT @ ALG **−64.54** |

### Strengths

- **Discrimination survives the vig.** +10.2% against raw odds with the
  bookmaker margin left in, over 99 bets — one of five entrants out of fifteen
  to finish positive.
- **Consistent across question structures.** Beats the field median in both the
  two-way (0.3089 vs 0.3515 for the worst of this five) and three-way (0.4936)
  markets. Its edge doesn't depend on the question shape.
- **Modal judgment is better than it admits.** 70.7% right when it commits to a
  favourite, while claiming 62.4%. Systematically underselling itself.

### Weaknesses

- **Still second to the market, everywhere.** 0.4376 vs 0.4271, in both markets,
  over 99 questions. Where a priced consensus exists, this model is not the
  thing to ask.
- **Overconfident where it acts.** +5.4 points on staked outcomes. Best of this
  five, still the wrong sign, and it is the direction that compounds.
- **Losses outnumber wins 71–28.** The bankroll is carried by a handful of long
  odds landing. Over a short horizon — a quarter's worth of decisions rather
  than a season's — that same profile reads as a losing streak.

### Where this agent should and shouldn't decide alone

| Route to it | Keep a human on it |
|---|---|
| Ranking options by likelihood; questions with no priced market; anything where its modal pick is the answer | Sizing exposure off its stated probability; low-probability/high-consequence calls; anything a market already prices |

---

## The other four, in brief

### GPT-5.1 — **606.51** (−39.3%)
Brier 0.4825, rank 9 of 16, overconfidence gap **+0.086**. Middling accuracy
carried into heavy losses by a field-average confidence error: 23 wins, 78
losses. Best call TUR @ AUS +221.15; worst CPV @ URU −75.43. Two-way Brier is
the second-best number in this whole report (0.3022) — but on only 10 scored
two-way questions, which is not enough to lean on.

### Gemini 3.1 Pro — **727.88** (−27.2%)
Brier 0.4503 (rank 4), gap **+0.067**. Genuinely good discrimination undone by
confidence: the fourth-best forecaster on the board finished seventh on money.
The cleanest illustration in this run that *being right more often and losing
more money are entirely compatible*. Best PAR @ GER +203.10; worst URU @ KSA
−82.04.

### DeepSeek V4 Pro — **871.62** (−12.8%)
Brier 0.4501 (rank 5), gap **+0.036** — the second-best calibration in this five
and the third-best in the field. Highest hit rate of the five at 31.0%. Still
finished down, which is the honest reminder that good calibration reduces the
bleed rather than guaranteeing a profit against a vigged line.

### Qwen 3.7 Max — **344.55** (−65.5%)
Brier 0.4671, gap **+0.148** — the worst in the field, and the worst bankroll in
the field. 15 wins in 99 bets. **The version it replaced, Qwen3 Max, finished at
1,028.44 — above its starting bankroll.** GLM shows the same inversion: GLM 5.2
finished at 472.79 against GLM 4.6's 708.67.

**The upgrade finding, stated carefully:** in this run, two of the labs' newer
releases were materially worse *at calibrated decision-making under a price*
than the versions they replaced, while presumably scoring better on the
capability benchmarks that justified the release. That is one season, one
domain, and a handful of version pairs — it does not establish that newer models
are generally worse. It does establish that "newer" is not evidence of "better
calibrated," and that if your upgrade path assumes otherwise, the assumption is
currently unmeasured.

---

## Method, stated so you can attack it

- **104 events priced**, June–July 2026 World Cup. Group matches: three-way
  90-minute result. Knockouts: two-way, who advances. Every entrant received an
  identical prompt and returned JSON probabilities summing to 1.
- **Locked before kickoff.** Only forecasts stored before the event started are
  eligible. The git history of `data/store.json` is the timestamp proof.
- **Scored** by multi-category Brier (`lib/scoring.js`), same rule for every
  entrant. Skill = `(baseline − Brier)/baseline`, shrunk by 10 phantom
  coin-flips.
- **Settlement:** final scores from ESPN's public feed; 80 matches additionally
  Merkle-proved against the TxODDS `daily_scores_roots` PDA on Solana
  (`scripts/verify-settlement.js`).
- **Bankroll:** quarter-Kelly on the single positive-edge outcome per event,
  edge > 2%, capped at 10% of bankroll, settled at the locked line. A
  deterministic fold — `node scripts/bankroll.js` twice gives byte-identical
  output.
- **Reproduce it:** clone the repo, `npm test`, `node scripts/bankroll.js`.

## What this report does not establish

- **One domain, one season.** Football results, ~100 questions per entrant. This
  says nothing directly about a model's judgment on your roadmap, and the only
  way to know that is to run it there.
- **Calibration is measured on selected outcomes.** The overconfidence gap
  covers the outcomes each model *chose to stake on* — a self-selected subset,
  by construction the ones where it disagreed most with the market. It is the
  decision-relevant subset, not the model's full distribution.
- **10 of 123 (event, market) pairs are excluded.** Outcomes here were
  reconstructed from the settled bet ledger; 10 pairs where every entrant's bet
  lost cannot be uniquely resolved from it. Those are disproportionately events
  the field got *wrong*, so **every Brier score in this report is very slightly
  flattering** to every entrant. The relative ordering is unaffected; the
  absolute numbers are marginally optimistic.
- **Two-way sample sizes vary** (10 for GPT-5.1, 30 for most). Roster
  substitutions mid-season mean not every entrant priced every event.
- **Virtual units throughout.** No real money, no real position, no claim about
  what this would do at size.

---

```
Generated by Uptick Systems · brier zero
The map is not the territory. This is how far apart they were.

Want this run on your models and your questions?  →  uptick.systems/assess
```
