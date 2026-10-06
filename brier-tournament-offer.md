# The Private Arena — offer & pricing

**Status:** Iteration 1 offer, ready to send. Not yet published as a page.
**Delivery:** manual, by Vaughn, using the harness already in this repo.
**Landing page:** copy below drops into a single-page section on
`arena.uptick.fyi/private` — no new infrastructure, no accounts, no login.
Payment is a Stripe Payment Link; there is no checkout to build.

---

## The page

### Headline

**Your model is confident. Is it right?**

### Subhead

We ran ten frontier models against a real betting market for a hundred events.
They assigned 32% to the outcomes they acted on; those outcomes came in 23% of
the time. Every single model erred in the same direction, ten of fifteen lost
money, and not one beat the market.

Now we run the same machine on your questions.

### The argument (three lines, above the fold)

- **Every model in the field was overconfident, and it cost them.** Across 1,514
  paper bets, the models assigned an average **32.1%** probability to the
  outcomes they chose to act on. Those outcomes happened **23.3%** of the time.
  All fifteen entrants were overconfident in the same direction, and how
  overconfident each one was predicts almost exactly where it finished on money
  (Spearman −0.90). No accuracy eval in your stack is measuring this.
- **Newer is not better.** In our public season, Qwen 3.7 Max finished last on
  money — behind the Qwen3 Max it replaced. GLM 5.2 finished behind GLM 4.6. If
  your upgrade path assumes the new version is a strict improvement in judgment,
  it is an assumption, not a finding.
- **A price is a harsher scorer than a rubric.** Every forecast here is settled
  against a real market line with the bookmaker margin left in. The model has to
  be right *and* better than the consensus to score.

### What you get

A private tournament, run by us, on questions that matter to your business.

1. **5–10 questions**, written with you, resolvable inside the window, with
   resolution criteria agreed in writing before anything is scored.
2. **Your models against the field.** Your agent, your fine-tune, or your
   shortlisted vendors — priced against the same ten frontier models on our
   public board, under one identical prompt.
3. **A leaderboard** — Brier score, skill vs. coin-flip, and calibration: where
   each entrant is overconfident and by how much.
4. **A paper P&L** where a market line exists — what each entrant would have
   done to a bankroll at quarter-Kelly stakes.
5. **A one-page verdict** in plain English: which entrant to trust with which
   class of question, and where each one is dangerous.
6. **A 30-minute readout call** to walk through it.

### What you don't get

Said plainly, because it is the reason to trust the rest:

- **Not a forecasting service.** If you want probabilities on demand,
  [FutureSearch](https://futuresearch.ai/pricing/) sells them for 15¢ and ranks
  above every model on our board. We measure judgment; we do not rent it.
- **Not a leaderboard subscription.** [Metaculus](https://www.metaculus.com/aib/)
  pays bot-makers $50k a season and ForecastBench is free. Public leaderboards
  are not a product and we will not sell you one.
- **Not real-money betting.** Virtual units only, throughout.
- **Not a large sample.** Ten questions is ten questions. The report says what
  the sample can and cannot support, every time.

### Pricing

| | **Season Pass** | **Calibration Audit** | **Standing Arena** |
|---|---|---|---|
| | $299 one tournament | **$1,500** | $299/mo |
| Questions | 5 | 20–30 | 5/month |
| Duration | 2 weeks | 3 weeks | rolling |
| Entrants | your model + our 10 | your shortlist (up to 4) + our 10 | your model + our 10 |
| Leaderboard + Brier | ✓ | ✓ | ✓ |
| Calibration breakdown | — | ✓ | ✓ |
| Paper P&L vs. market line | where a line exists | ✓ | where a line exists |
| One-page verdict | ✓ | ✓ | monthly |
| Readout call | — | 30 min | 30 min/quarter |
| Reproducible artifact you keep | ✓ | ✓ | ✓ |

**Recommended: the Calibration Audit.** It is the only tier with enough
questions to say something defensible about calibration, and it is the one that
answers an actual budget decision — *which model do we standardise on, and where
do we not let it decide alone.*

The $299 Season Pass exists to be cheap enough to say yes to on a first email.
Treat it as a paid trial: it credits in full against a Calibration Audit booked
within 30 days.

### Guarantee

If the report does not change how you'd route at least one class of decision,
don't pay. Stated on the page, honoured without argument. At these prices the
refund risk is smaller than the credibility the line buys.

### CTA

**Start a private tournament →** (Stripe Payment Link)
**Or: send us the question you'd want on the board.** (mailto, no form)

---

## Positioning notes (internal — not on the page)

**The wedge is the negative result.** Everyone selling in this space leads with
"our AI is accurate." We lead with *ten frontier models were measured against a
price and most of them lost money.* It is true, it is reproducible from a public
repo, and it lands with exactly the person who is being told by four vendors
that their model is the smartest one. Do not soften it in outreach.

**Never claim we beat the market.** We don't, and the board says so. The honesty
is the asset — it is the reason a buyer believes the number when it is about
their model.

**Price anchoring.** [Braintrust is $249/mo and Galileo $100/mo](https://noveum.ai/en/blog/best-ai-agent-evaluation-platforms)
for self-serve eval tooling. If the conversation drifts to "why not just use
Braintrust," the answer is that Braintrust scores your model against your
rubric, and this scores your model against a market that was willing to take the
other side. Different question. Don't compete on tooling; we would lose.

**Two objections to have an answer ready for:**
- *"Football isn't our domain."* Correct — the public season is the proof the
  machine works and the scoring is honest, not the deliverable. Your tournament
  is your questions. Offer to show the prompt and the scoring code.
- *"Ten questions can't tell me anything."* Largely correct, and the report says
  so itself. That is the argument for the 20–30-question Audit, which is why the
  objection is a buying signal, not a loss.

**Capacity.** One tournament is roughly 4–6 hours of Vaughn's time (see
`brier-tournament-delivery.md`). Cap at **three concurrent** tournaments. Past
that, the side asset is eating the primary business and the correct move is to
raise the price, not to hire.
