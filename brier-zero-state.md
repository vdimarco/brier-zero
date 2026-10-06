# Brier Zero — initial state snapshot

**Date:** 2026-07-31 · **Owner:** Vaughn DiMarco · **Purpose:** baseline before a
2-iteration revenue test. Target: $500–2k/mo **or** 2–3 qualified Uptick leads/mo
within 60 days.

Every number below is measured, not estimated. Traffic comes from the PostHog
project *Uptick HQ* (id 500056); leaderboard and P&L numbers are recomputed from
`data/store.json` and `data/backtests/bankroll.json` in this repo.

---

## 1. What exists now

### There are three different things called "Brier Zero." Only one of them is real.

| Asset | What it is | Data | Status |
|---|---|---|---|
| **arena.uptick.fyi** | Leaderboard landing page — agents ranked by Brier score across N=1 / N=1,000 / N=1,000,000 questions | **Simulated.** "Season 0 · SIMULATED · SEEDED · REPRODUCIBLE". Agents are fictional (KESTREL, BASILISK, CASSANDRA-2). Human crowd baseline finishes 9th. | Live, honest about being simulated, ~zero traffic |
| **worldcup.uptick.fyi** (this repo) | 10 frontier models + the betting market forecast real World Cup matches; Brier-scored, paper-traded quarter-Kelly, settlement Merkle-proved on Solana | **Real.** 104 matches priced, 1,545 paper bets, 15 entrants, 80 on-chain-verified settlements, full git audit trail | Live, working, **instrumented in production since 2026-08-30** (PR #55 merged as `9e0e160`) |
| **`src/brier_zero/`** (Python) | Map/territory detection engine — restatement gate, employee whisper proxy, Map Fidelity Score, skill audit | Library sketch + PRD v2.0 in Linear | Not shipped as a product |

**The strategic fact this snapshot exists to surface:** the page with the traffic
funnel (arena) runs on simulated data, and the system with real, verifiable,
differentiated results (the World Cup harness) has no funnel, and had no
analytics either until 1 August.
Every revenue path below is an argument about closing that gap.

### Traffic — arena.uptick.fyi

PostHog, all data ever recorded for the host:

| Metric | Value |
|---|---|
| Total pageviews | **33** |
| Unique visitors | **10** |
| First pageview | 2026-07-13 |
| Last pageview | 2026-07-29 |
| Days with any traffic | 7 |
| Referrers | `$direct`, `va.ug.hn` (Vaughn's own site), `www.facebook.com` (1 day) |
| `waitlist_signup` | 1 (1 person) |
| `ask_submitted` | 2 (1 person, same day as `theater_completed` — almost certainly self-testing) |
| `book_call_click` | **0** |

For scale, the same PostHog project over the same month:
`www.uptick.systems` — 523 pageviews / 184 visitors, 52 `cta_click` from 12
people, 8 `book_call_click` from 4 people, 1 `contact_form_submit`.

**Read:** arena is not a demo with an audience. It is a page ~10 people have
seen, most of them arriving from Vaughn. There is no inbound to convert. Any
revenue in the next 60 days has to come from **outbound**, and the page's job is
to make the outbound credible — not to acquire.

`worldcup.uptick.fyi` sent no events to PostHog at all, so its traffic to date
is genuinely unknown and unrecoverable. The snippet was written 2026-08-01,
sat in an unmerged PR for four weeks, and shipped 2026-08-30 when #55 merged.
Verified by fetching `https://worldcup.uptick.fyi/` directly: HTTP 200, snippet
present in the served HTML. **Nothing before 30 August exists and never will.**
The first reading will be whatever the Iteration 2 post drives.

### Who uses it

Unknown at any meaningful resolution, because n=10. Of those 10, at least one is
Vaughn. No user has ever clicked through to book anything.

### What the real system can actually prove (recomputed today)

Brier leaderboard over eligible, pre-kickoff-locked forecasts on resolved
matches (`(baseline − Brier) / baseline`, shrunk by 10 phantom coin-flips):

| # | Entrant | n | Avg Brier | Skill |
|---|---|---|---|---|
| 1 | **The Market** (de-vigged TxODDS) | 99 | 0.4271 | 0.2861 |
| 2 | Claude Opus 4.7 | 99 | 0.4376 | 0.2695 |
| 3 | MiniMax | 94 | 0.4643 | 0.2577 |
| 4 | Gemini | 99 | 0.4503 | 0.2493 |
| 5 | DeepSeek V4 Pro | 99 | 0.4501 | 0.2474 |
| … | … | | | |
| 16 | Qwen3 Max | 93 | 0.5033 | 0.2036 |

**No AI model beats the market.** That holds over ~100 matches per entrant.

Paper bankroll, 1,000 units each, quarter-Kelly, raw odds (vig included):

| Entrant | Final | Bets | Hit rate |
|---|---|---|---|
| MiniMax | **1,124.60** | 101 | 25.7% |
| Claude Sonnet 4.5 | 1,118.71 | 101 | 32.7% |
| Claude Opus 4.7 | 1,101.59 | 99 | 28.3% |
| DeepSeek V3.1 | 1,101.59 | 103 | 27.2% |
| Qwen3 Max | 1,028.44 | 103 | 26.2% |
| DeepSeek V4 Pro | 871.62 | 100 | 31.0% |
| … | | | |
| Qwen 3.7 Max | **344.55** | 99 | 15.2% |

**5 of 15 entrants finished above their starting bankroll. The worst lost 65.5%
of it.** Newer model versions are not reliably better: Qwen 3.7 Max finished
last on money despite replacing Qwen3 Max; GLM 5.2 (472.79) underperformed GLM
4.6 (708.67); Kimi K3 (487.38) barely beat Kimi K2 (473.29).

That last line is the most commercially interesting sentence in this document.
It is a measured, reproducible claim that **frontier model upgrades can degrade
calibrated judgment under a real price**, and almost nobody has that evidence in
a form they can hand to a CFO.

---

## 2. Competitive landscape

### 2a. The benchmark category pays *out*, it does not charge

| Product | What it offers | What it charges |
|---|---|---|
| **[Metaculus AI Forecasting Benchmark](https://www.metaculus.com/aib/2026/spring/)** | Primary bot tournament, 3×/year, 300–500 questions/season; human baseline included | **Pays entrants $50,000/season.** Plus a $7,000 Market Pulse tournament and rolling $1,000 two-week MiniBench rounds |
| **[ForecastBench](https://www.forecastbench.org/explore/)** (Forecasting Research Institute / Wharton) | Dynamic academic benchmark of AI forecasting vs. superforecasters; public leaderboard | **Free.** Academic, grant-funded |
| **[Foresight Arena](https://arxiv.org/pdf/2605.00420)** | On-chain benchmark for AI forecasting agents | Free / research |

This is the single most important competitive fact in this document. **Nobody
pays for a forecasting leaderboard, because two well-funded organisations give
one away and one of them pays you $50k to enter.** Any plan whose revenue line
is "access to the Brier Zero leaderboard" is dead on arrival, and Iteration 1
must be priced as *a service that produces a decision*, not as leaderboard
access.

### 2b. Forecasts themselves are already commoditised

| Product | Offer | Price |
|---|---|---|
| **[FutureSearch](https://futuresearch.ai/pricing/)** | Agent forecasters; #1 in Metaculus Summer 2026 FutureEval, above superforecaster median on ForecastBench | **$0.15–$2.00 per forecast**, $20 free credit, enterprise on request |
| **[Mantic](https://www.mantic.com/)** | AI event forecasting at industrial scale (supply-chain shocks, geopolitics) | $4M pre-seed; enterprise, undisclosed |
| **[Cassi AI](https://cassi-ai.com/)** | Probabilistic forecasting platform; top-ranked on ForecastBench | Enterprise, undisclosed |

"Give me a probability on X" costs **fifteen cents** from a vendor that
out-ranks every model on our board. Brier Zero cannot sell forecasts.

### 2c. Where money actually is: private evaluation and eval infra

| Product | Offer | Price |
|---|---|---|
| **[Vals AI](https://www.vals.ai/product)** | Independent third-party benchmarking; **sells private benchmark creation** to labs and enterprise teams in legal/finance/tax/health | Enterprise, undisclosed |
| **[Braintrust](https://www.braintrust.dev/articles/braintrust-vs-galileo-ai)** | Eval-first LLM platform | **$249/mo** Pro (5 GB, 50K scores) |
| **[Galileo](https://noveum.ai/en/blog/best-ai-agent-evaluation-platforms)** | LLM/agent evaluation | **$100/mo** Pro (50K traces) |
| **[LangSmith](https://www.morphllm.com/comparisons/braintrust-vs-langsmith)** | Tracing + evals | **$39/seat/mo** |
| **[Apify prediction-market API](https://apify.com/lizaraco/prediction-market-data/api/openapi)** | Kalshi/Polymarket/Manifold odds | $2.00 per 1K requests |

**The read across 2a–2c:** the public leaderboard is a marketing asset for
everyone in this space, never the product. Vals AI is the closest structural
analogue to a viable Brier Zero business — public benchmark for credibility,
private benchmark for revenue. The $100–$249/mo band from Braintrust/Galileo is
the honest ceiling for anything that looks like self-serve tooling, and Uptick
cannot compete there on engineering. Which means **Brier Zero's price has to
come from judgment delivered, not software rented.**

### 2d. What Brier Zero has that none of them do

Not accuracy — the market beats our whole field, and FutureSearch beats our
field too. What we have is:

1. **A market baseline as a scored competitor.** ForecastBench uses
   superforecasters; Metaculus uses its crowd. Brier Zero scores frontier models
   against a *priced, vigged, de-vigged consensus line* and settles P&L against
   it. That answers "is the model good enough to bet" rather than "is the model
   accurate."
2. **Cross-lab, single-prompt, identical conditions.** Ten labs, one prompt, one
   scoring rule, versions swapped mid-season with predecessors retained.
3. **Tamper-evident settlement.** Every score Merkle-proved against an on-chain
   root; every forecast timestamped in git before its kickoff.
4. **A measured negative result nobody else is publishing:** newer frontier
   releases lost money where their predecessors made it.

---

## 3. Buyer hypothesis

Scored 1–5. **WTP** = willingness to pay real money this quarter. **Reach** =
can Vaughn get to a decision-maker in <2 weeks without paid acquisition.
**Fit** = alignment with what Uptick actually sells (assessments/engagements).

| # | Buyer | WTP | Reach | Fit | Score | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Mid-market execs making a model-selection or AI-spend decision** ("should we upgrade to the new version, and can we trust its confidence?") | 5 | 4 | **5** | **14** | **Primary.** This is Uptick's existing buyer, and the bankroll result is a live sales argument for them |
| 2 | **Agent builders / AI-native startups** who need a third-party credibility artifact for their own sales or fundraise | 4 | 4 | 3 | 11 | **Secondary.** Real WTP for "independent benchmark on our agent"; small budgets, fast decisions |
| 3 | **Trading / sports-analytics shops** (the market-baseline angle is native to them) | 5 | 2 | 2 | 9 | Highest WTP, worst reach. Cold, credentialed market. Park it |
| 4 | **VCs doing agent diligence** | 3 | 3 | 3 | 9 | Will happily *read* a report, rarely pay for one. Useful as distribution, not revenue |
| 5 | **AI lab researchers** | 1 | 3 | 1 | 5 | Zero WTP — they have Metaculus paying them $50k and ForecastBench for free |
| 6 | **Think tanks / competitive forecasters** | 2 | 2 | 1 | 5 | Grant-funded, slow, and already served |

**Conclusion that should govern both iterations:** the buyer is not the
forecasting community. It is the operator who has to make a decision under
uncertainty and would like to know whether the model in their stack is
calibrated enough to be trusted with it. That buyer is already Uptick's buyer,
which is why the lead-magnet framing (Iteration 2) is structurally stronger than
the tournament framing (Iteration 1) — even though Iteration 1 is the one with a
direct price tag.

---

## 4. Fastest path — minimum viable paid tier, ranked by speed to test

| Rank | Offer | Price | Build | Time to first ¥ | Why this rank |
|---|---|---|---|---|---|
| **1** | **Model Calibration Audit** — run a company's shortlisted models over 20–30 resolved questions in their domain, score Brier + market-equivalent P&L, deliver a 1-page verdict + a 30-min readout | **$1,500–$2,500** one-off | Harness exists; swap the question source. ~1 weekend | **7–14 days** | Uses the machine as it stands, prices judgment not software, sells to Uptick's existing buyer, and one sale hits the bottom of the monthly target on its own |
| **2** | **Private tournament** (Iteration 1 as briefed) | $99–$299/mo, or $750 flat per tournament | Manual setup + Notion/HTML report. 1 weekend | 14–30 days | Concrete and testable, but see the pricing note below |
| **3** | **Benchmark report as lead magnet** (Iteration 2 as briefed) | $0 → Uptick assessment | Report template + one real run. ~1 weekend | 14–21 days to a lead | No direct revenue, but the highest-leverage use of the one genuinely novel result we own |
| 4 | Sponsored public season ("Brier Cup, presented by X") | $2–5k | Zero build | 30–60 days | Requires an audience we do not have (10 visitors) |
| 5 | API / data access to the ledger | $99+/mo | Real engineering | 60+ days | **Kill.** Violates the no-major-engineering constraint; Apify sells odds at $2/1K |

### One concern with the brief, stated once

**$99–$299/month is the wrong shape for Iteration 1.** A private tournament that
Vaughn sets up by hand is a service with a fixed delivery cost, sold to a buyer
with an episodic need. Monthly pricing invites churn after month one, caps the
sale at $299, and creates a support obligation for a side asset. The same
buyer will pay **$750–$2,500 once** for the same work delivered as a verdict.

Per the brief I am building Iteration 1 at the specified price point anyway —
the offer page below leads with a $299 tier so the hypothesis is tested as
written — but it carries a $1,500 "Calibration Audit" tier alongside it, and the
outreach is written so a reply can land on either. If the $299 tier converts and
the $1,500 tier does not, the brief was right and I was wrong; that is a cheap
thing to find out in the same test.

---

## 5. Baseline to beat (measured today, 2026-07-31)

| Metric | Today |
|---|---|
| arena.uptick.fyi monthly revenue | **$0** |
| arena.uptick.fyi unique visitors, all time | **10** |
| Uptick leads attributable to Brier Zero | **0** |
| `book_call_click` from arena | **0** |
| worldcup.uptick.fyi traffic to 2026-07-31 | **unmeasured** — no analytics until 2026-08-01; that history is gone |
| worldcup.uptick.fyi traffic before 2026-08-30 | **zero, permanently** — uninstrumented until #55 merged |

Anything above zero is a signal. Zero across both iterations is the kill.
