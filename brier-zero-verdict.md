# Brier Zero — verdict after two iterations

**Date:** 2026-07-31 · **Decision date:** 2026-08-14

---

## The one-paragraph version

Both iterations are built and neither has been tested in market, because both
end in an action only Vaughn can take — sending ten emails and publishing one
post. What the research *did* settle is that the original framing was pointed at
the wrong asset: **arena.uptick.fyi is a page with 10 lifetime visitors running
simulated data, while the World Cup harness in this repo is a real, reproducible
system that just produced a genuinely novel measured finding.** The revenue path
does not run through the arena leaderboard. It runs through that finding. Ship
Iteration 2 this week, run Iteration 1's ten emails behind it, and judge both on
14 August against thresholds already written down.

---

## What the research actually established

**1. Nobody pays for a forecasting leaderboard.**
[Metaculus pays entrants $50,000 a season](https://www.metaculus.com/aib/2026/spring/).
[ForecastBench](https://www.forecastbench.org/explore/) is free.
[FutureSearch sells forecasts at $0.15](https://futuresearch.ai/pricing/) and
outranks every model on our board. Three well-funded organisations give away or
subsidise everything Brier Zero could charge for as a benchmark. **Any plan
whose revenue line is leaderboard access or forecast supply is dead**, and the
plans in this repo were rewritten accordingly.

**2. The money in this category is private evaluation, not public benchmarks.**
[Vals AI](https://www.vals.ai/product) is the structural template: public
benchmark for credibility, private benchmark creation for revenue.
Self-serve eval tooling caps out around
[$100–$249/mo](https://noveum.ai/en/blog/best-ai-agent-evaluation-platforms)
(Galileo, Braintrust), which Uptick cannot and should not compete in. The price
has to come from judgment delivered, not software rented.

**3. There is no audience to convert.** arena.uptick.fyi: 33 pageviews, 10
unique visitors, ever — mostly referred from Vaughn's own site. 0
`book_call_click`. Anything that happens in the next 60 days is outbound.

**4. The asset is not where the brief assumed.** The arena page runs a *simulated*
Season 0 with fictional agents. The World Cup harness is real: 104 events, 1,545
paper bets, 15 entrants, 80 on-chain-verified settlements, every forecast
timestamped in git before its kickoff. **The credibility lives entirely in the
second one, and it has no analytics and no funnel attached to it.**

**5. Running the benchmark produced a finding worth more than either offer.**
All 15 entrants were overconfident on the outcomes they chose to act on — 32.1%
assigned, 23.3% realised — and that gap predicts final bankroll at Spearman
−0.90. The models are *under*confident on their modal picks and overconfident
exactly where they act. No model beat the market. Two labs' newer releases
finished behind the versions they replaced.

That last item is the actual product. It is true, checkable, non-obvious,
uncomfortable for the vendors selling into Vaughn's buyers, and it is
structurally identical to the argument Uptick already makes: *the internal
number and the outside number stopped agreeing and nobody was measuring the gap.*

---

## The verdict

**Not killed. Not yet earning. Sequenced, priced, and on a 14-day clock.**

| | Verdict | Why |
|---|---|---|
| **Iteration 1 — paid private tournament** | **Continue, reprice, run second** | Untested, not falsified. But $99–299/mo is the wrong shape for a hand-delivered service bought episodically. Lead with the **$1,500 Calibration Audit**; keep $299 as the cheap yes |
| **Iteration 2 — benchmark report lead magnet** | **Continue, promote to primary, run first** | Costs one afternoon, carries the one genuinely novel result, and manufactures the credibility Iteration 1's emails depend on |
| **arena.uptick.fyi as a destination** | **Deprioritise** | Simulated data, 10 lifetime visitors. Keep it as the host for the real report; stop treating it as the asset |
| **API / data access tier** | **Killed** | Needs real engineering, and Apify sells prediction-market odds at $2/1K |
| **Sponsored public season** | **Parked** | Requires an audience that does not exist yet |

### Do this, in this order

1. **Install PostHog on `worldcup.uptick.fyi`.** 5 minutes. Everything below is
   unmeasurable without it, and it is currently the only Uptick property flying
   blind.
2. **Publish `sample-report.md`** at `arena.uptick.fyi/report`. A real report on
   that domain also repairs the credibility problem of a simulated landing page.
3. **Post the LinkedIn version and the X thread** with campaign UTMs. Reply to
   every substantive comment within two hours — the leads come from replies, not
   the post.
4. **Create three Stripe Payment Links** ($299 / $1,500 / $299-mo). Before
   sending, not after a reply arrives.
5. **Name the ten recipients** in `outreach-drafts.md` and send all ten inside
   one week. Warm targets get the $1,500 Audit; cold targets get the $299 pass.
6. **Judge on 2026-08-14.** Do not extend.

### Time budget

**One weekend to ship all of it** (report page + post + Stripe links + ten
emails), then ~1 hour/week of follow-up until 14 August. If a tournament sells,
add ~6 hours per delivery, capped at three concurrent. **If it needs more than
that, the answer is to raise the price, not to spend more of the week.** This is
a side asset and its budget is a side asset's budget.

---

## The decision rule on 14 August

| Outcome | Decision |
|---|---|
| **1+ payment** (any tier) | **Continue.** Run the second cohort at $1,500 only, drop the $299 tier, cap at 3 concurrent. Two sales/month clears the $500–2k target |
| **0 payments, 1+ qualified Uptick lead** | **Continue as a lead magnet only.** Keep publishing reports quarterly, stop selling tournaments, fold the finding into Uptick's standard pitch |
| **3+ positive replies, no payment or lead** | **One more iteration, priced differently.** The interest is real and the price or the offer is wrong. Test a free pilot with a named logo in exchange for a public report |
| **0 payments, 0 leads, 0 engagement** | **Kill. See below** |

---

## The kill note — pre-written, to be used verbatim if 14 August comes back empty

> Brier Zero does not convert. Ten outbound messages and one public post
> produced no payment, no qualified Uptick lead, and no engagement. The
> hypothesis that a public forecasting benchmark can be sold, or can generate
> demand for Uptick's assessments, is falsified for this audience at this price.
>
> The competitive reason is understood and was visible before the test:
> Metaculus pays $50k a season for the same activity, ForecastBench gives the
> benchmark away, and FutureSearch sells better forecasts for fifteen cents.
> Brier Zero was never going to win that category, and its real differentiator —
> scoring models against a price rather than a rubric — was not enough to
> overcome having no audience.
>
> **Brier Zero stays a free demo.** The World Cup board stays live because it
> costs nothing to leave running and it is a genuine credibility artifact in
> conversations Uptick is already having. The calibration finding stays in the
> Uptick pitch deck, where it does more work than it ever did as a product.
>
> **No further energy on Brier Zero until Uptick is at $10k/month.** Not a
> weekend, not a landing page, not "just one more tier." The next time this file
> is opened, it should be because Uptick can afford a side asset.

---

## The one thing that survives either outcome

Even under the kill, this run produced a measured, reproducible, uncomfortable
claim about frontier models: **they are underconfident where they are obviously
right and overconfident exactly where they decide to act, and the size of that
error predicts what it costs you.** That belongs in Uptick's sales conversation
regardless of whether a single tournament ever sells. It cost nothing to
discover and it is the most defensible thing either property has ever produced.
