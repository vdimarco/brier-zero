# Brier Zero — revenue autoresearch log

Baseline at start (measured, PostHog project *Uptick HQ*, 2026-07-31):
arena.uptick.fyi has **33 pageviews / 10 unique visitors, ever**. $0 revenue.
0 Uptick leads. 0 `book_call_click`. worldcup.uptick.fyi: **no analytics
installed**, traffic unknown.

---

## Iteration 1 — 2026-07-31

### Hypothesis

Teams and AI labs will pay $99–299/month to run private forecasting tournaments
and compare their agents' performance.

### Artifact

- `brier-tournament-offer.md` — offer page copy, three tiers ($299 Season Pass /
  $1,500 Calibration Audit / $299-mo Standing Arena), guarantee, positioning
  notes, objection handling.
- `brier-tournament-delivery.md` — manual delivery runbook, ≤6h of Vaughn's time
  per tournament, Stripe Payment Links only, no new infrastructure, capacity cap
  of 3 concurrent.
- `outreach-drafts.md` — 10 ranked targets, 5 message drafts (warm operator,
  agent builder, cold, partnership, no-ask), send rules, tracking table.
- `brier-zero-state.md` — state snapshot, competitive landscape, buyer scoring.

### Results

**Built and ready to send. Not yet sent — sending requires Vaughn to name the
ten recipients and press send, which is the one step of this iteration that
can't be automated. Zero responses recorded, because zero messages have gone
out.** The metric (3+ positive responses / 1 payment in 14 days) is not yet
measurable and nothing below should be read as if it were.

What the research *did* settle, before any outreach:

1. **The category pays out; it does not charge.**
   [Metaculus](https://www.metaculus.com/aib/2026/spring/) pays bot-makers
   **$50,000 per season** across three seasons a year, plus a $7,000 Market
   Pulse tournament and rolling $1,000 MiniBench rounds.
   [ForecastBench](https://www.forecastbench.org/explore/) is free and
   academic. **Any version of this offer priced as "access to a leaderboard" is
   dead on arrival**, and the offer was rewritten to sell a verdict instead.
2. **Forecasts are commoditised.**
   [FutureSearch](https://futuresearch.ai/pricing/) sells agent forecasts at
   **$0.15–$2.00 per question** and ranks #1 in Metaculus's Summer 2026
   FutureEval, above every model on our board. Brier Zero cannot sell forecasts.
3. **The viable analogue is [Vals AI](https://www.vals.ai/product)** — public
   benchmark for credibility, private benchmark creation for revenue. That is
   the shape the offer now takes.
4. **$99–299/mo is the wrong price shape** for a hand-delivered service bought
   episodically. Flagged in `brier-zero-state.md` §4, built as briefed anyway
   with a $1,500 one-off tier alongside so both hypotheses get tested in the
   same ten emails.
5. **There is no inbound to convert.** 10 unique visitors ever, most referred
   from Vaughn's own site. This must be an outbound test or it is not a test.

### Kill or Continue?

**Continue — conditionally, and reordered.** The hypothesis is not falsified;
it is untested, and the artifacts to test it now exist. But the competitive read
says the $299 monthly framing is the weakest version of it, and the state
snapshot says there is no audience to sell to yet. **Iteration 2 should ship
first** — it costs nothing to publish, and it manufactures the credibility that
makes the Iteration 1 emails answerable.

### Next Action

1. ~~Install PostHog on `worldcup.uptick.fyi`.~~ **Done 2026-08-01** (commit
   `3b08c65`). The prerequisite is cleared.
2. Ship Iteration 2's post + report (below).
3. Name the ten recipients in `outreach-drafts.md`, then send all ten inside one
   week, leading with the $1,500 Calibration Audit for warm targets and the $299
   Season Pass for cold ones.
4. Create the three Stripe Payment Links before sending, not after a reply.
5. Judge on 2026-08-14. **0 positive replies after all ten are sent and followed
   up once → Iteration 1 is falsified. Stop.**

---

## Iteration 2 — 2026-07-31

### Hypothesis

VCs and AI labs evaluating agent investments will find a "Brier Zero Benchmark
Report" useful as due diligence, and it will drive qualified Uptick leads.

### Artifact

- `brier-report-template.md` — one-page-per-agent format with a mandatory
  self-attack section.
- `sample-report.md` — **a real run, not a mock.** Five publicly available
  models (Claude Opus 4.7, GPT-5.1, Gemini 3.1 Pro, DeepSeek V4 Pro, Qwen 3.7
  Max) benchmarked from committed data, plus ten controls and the market line.
- `public-post.md` — LinkedIn post, 8-tweet thread, blog outline, distribution
  checklist, explicit success thresholds.

### Results

**The report was actually generated, and the run produced a finding that was not
in the brief and is stronger than the one the brief assumed.**

Recomputed from `data/store.json` and `data/backtests/bankroll.json`:

- **All 15 entrants were overconfident on the outcomes they chose to act on.**
  Across 1,514 staked decisions the field assigned an average **32.1%** to the
  outcomes it backed; those outcomes happened **23.3%** of the time. No entrant
  was on the other side of zero.
- **That gap is nearly the whole P&L story.** Overconfidence gap vs. final
  bankroll: **Spearman −0.90, Pearson −0.85** (n=15).
- **The error has a shape.** On their modal pick the models are *under*confident
  (Claude Opus 4.7: says 62.4%, right 70.7%). The overconfidence is concentrated
  in the low-probability outcomes they talk themselves into acting on — the only
  range where a decision is expensive. The market line is near-calibrated
  throughout (−0.023).
- **No AI beat the market** (0.4271 vs. best model 0.4376) over ~100 questions
  each.
- **Newer was not better.** Qwen 3.7 Max finished last on money (344.55) behind
  the Qwen3 Max it replaced (1,028.44); GLM 5.2 (472.79) behind GLM 4.6
  (708.67).

Two honest limits recorded in the report itself: outcomes were reconstructed
from the settled bet ledger, so 10 of 123 (event, market) pairs — disproportionately
ones the field got wrong — are excluded, making every Brier score marginally
flattering; and calibration is measured on self-selected staked outcomes.

**Not yet posted.** Publishing to LinkedIn/X is Vaughn's to send. Lead metric
(1+ qualified lead in 14 days) is not yet measurable.

**Correction made during this iteration:** the offer and outreach copy initially
carried a placeholder line about models being overconfident on their modal picks.
The data says the opposite — they are *under*confident there. Both documents were
rewritten to the measured claim. This mattered: the original framing would have
been falsified by the first reader who checked the repo.

### Kill or Continue?

**Continue, and promote this to the primary path.** The lead-magnet hypothesis
is the one with a genuinely novel, checkable, non-obvious result behind it — and
that result is structurally the same argument Uptick sells (the internal number
and the outside number stopped agreeing, and nobody was measuring the gap). It
costs one afternoon to publish and it makes Iteration 1's outreach answerable.

### Next Action

1. Publish `sample-report.md` at `arena.uptick.fyi/report` — a real report on
   that domain also fixes the credibility gap of a simulated-data landing page.
2. Post the LinkedIn version + X thread with campaign UTMs.
3. Reply to every substantive comment within 2 hours.
4. Judge on 2026-08-14 against the thresholds in `public-post.md`:
   20+ reactions / 5+ substantive comments / 1+ qualified DM / 1 assessment
   booked. **Zero engagement AND zero leads → the asset is not a lead magnet.**
