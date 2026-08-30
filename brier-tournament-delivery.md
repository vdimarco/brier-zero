# Private tournament — manual delivery process

**Constraint this document exists to enforce:** a tournament is **≤6 hours of
Vaughn's time**, spread over the window, using tooling that already exists in
this repo. If a step needs new code, cut the step. If a customer needs a
feature, the answer is "not in this version" and the price stays where it is.

Nothing here requires a backend, an account system, a database migration, or a
deploy. Everything is: a JSON file, a script that already runs, and a page.

---

## Total time budget

| Phase | Time | When |
|---|---|---|
| 0. Payment & intake | 20 min | day 0 |
| 1. Question design call | 45 min | day 1–2 |
| 2. Set up the run | 60 min | day 2–3 |
| 3. Collect forecasts | 15 min (mostly waiting) | day 3 |
| 4. Mid-window check | 10 min | day 7 |
| 5. Resolve & score | 60 min | day 14 |
| 6. Write the report | 90 min | day 14–15 |
| 7. Readout call | 30 min | day 15–16 |
| **Total** | **≈5h 20m** | 2 weeks elapsed |

The Calibration Audit (20–30 questions) is the same process with a longer
resolve-and-score step: budget **8 hours** over 3 weeks, which is why it prices
at $1,500 and not at 5× the Season Pass.

---

## Phase 0 — Payment & intake (20 min)

1. Customer pays via **Stripe Payment Link**. Three links, created once, no code:
   - Season Pass — $299, one-time
   - Calibration Audit — $1,500, one-time
   - Standing Arena — $299/month, recurring
   Set each link's *after payment* redirect to a thank-you page and enable
   "collect customer name + company."
2. On payment, Stripe emails you. Reply within 24h from your own address —
   never automated — with the intake questions:
   - What decision is riding on this?
   - Which models/agents are entering? (API access or vendor names)
   - 10 candidate questions, or a domain and we'll draft them
   - Who's on the readout call?
3. Create a folder: `tournaments/<customer-slug>/`. Everything lives there.

**Refund rule:** anyone who asks, gets it, no questions. Log it in
`brier-zero-log.md` — a refund is the strongest possible signal and must not
disappear quietly.

## Phase 1 — Question design call (45 min)

The highest-leverage part of the whole engagement, and the part the customer
will actually remember. This is the restatement gate from `docs/LIBRARY.md`
applied by hand.

For each question, agree **in writing before anything is scored**:

- **The question**, in one sentence, with a subject and a verb.
- **The resolution date**, inside the tournament window.
- **The resolution source** — a named URL, dashboard, or person who will state
  the answer. If no such source exists, the question is not scoreable. Cut it.
- **The outcome set** — 2 or 3 mutually exclusive, collectively exhaustive
  outcomes. No "other."
- **The official map** (optional, and where the value is): what does the
  customer's own dashboard/roadmap currently imply the answer is? Record it as a
  probability. Divergence between the map and the agents' price is the single
  most useful line in the final report.

Red flags that mean the question is unusable — say so on the call:
- resolves after the window
- resolution depends on someone's opinion at the time
- the customer already knows the answer
- the outcome is under the customer's own control (they can force it either way)

Aim to land **5 clean questions** (or 20–30 for an Audit). Ending the call with
4 good questions beats 8 mushy ones.

## Phase 2 — Set up the run (60 min)

1. `cp models.config.json tournaments/<slug>/models.config.json` and add the
   customer's entrants. Any OpenRouter slug works; a customer's private endpoint
   goes in as a custom entry.
2. Write `tournaments/<slug>/questions.json`:
   ```json
   [{ "id": "q1",
      "text": "Will the chip program's tape-out pass thermal validation by 2026-09-30?",
      "market": "advance",
      "outcomes": ["home", "away"],
      "outcomeLabels": { "home": "passes", "away": "does not pass" },
      "resolutionSource": "https://…",
      "resolvesAt": "2026-09-30T23:59:00Z",
      "officialMap": { "home": 0.9, "away": 0.1 } }]
   ```
   `market: "advance"` = 2 outcomes, `"regulation"` = 3. Both are already
   supported by `lib/scoring.js`; no new market type gets invented for a
   customer.
3. Confirm the prompt. Use `scripts/render-prompts.js` to print the exact prompt
   each model will receive, and **paste it into the customer email**. Every
   entrant sees identical text — that is the whole methodological claim, and
   showing it pre-empts the "you prompted mine badly" objection at resolution.

## Phase 3 — Collect forecasts (15 min)

```bash
OPENROUTER_API_KEY=sk-or-... node scripts/predict.js \
  --questions tournaments/<slug>/questions.json \
  --models tournaments/<slug>/models.config.json \
  --out tournaments/<slug>/forecasts.json
```

Then, non-negotiably:

- **Commit `forecasts.json` immediately**, before any question resolves.
  `git commit -m "tournament <slug>: forecasts locked"`. The commit timestamp is
  the customer's proof that nothing was edited after the fact. This is the same
  audit property the public board sells and it costs one command.
- Email the customer: "forecasts are locked, here's the commit hash." Nobody
  else in this market does this. It takes 60 seconds and it is most of why the
  final number gets believed.

## Phase 4 — Mid-window check (10 min)

One email at the halfway point: which questions look like they'll resolve
cleanly, which look ambiguous. Flag ambiguity **now**, not at scoring time — an
argument about resolution criteria after the fact costs the whole engagement.

If a question has become unresolvable, drop it and say so in writing. Do not
quietly re-interpret it.

## Phase 5 — Resolve & score (60 min)

1. Record each outcome in `tournaments/<slug>/results.json`, with the source URL
   and the date observed. Never resolve from memory.
2. `node scripts/backtest.js --dir tournaments/<slug>` → leaderboard, Brier per
   entrant, skill vs. coin-flip.
3. Where a market line existed, `node scripts/bankroll.js --dir tournaments/<slug>`
   → paper P&L. If no line existed, **omit the P&L section entirely** rather
   than inventing a counterfactual price.
4. Sanity check before anything goes out: does any entrant score better than
   perfect, or worse than 2? Does any n disagree with the question count? Both
   mean a config error, not a finding.

## Phase 6 — Write the report (90 min)

Use `brier-report-template.md`. Deliver as a **single self-contained HTML file**
plus the raw JSON — no Notion, no login, no link that can rot. The customer can
email it internally, which is how the next lead arrives.

Rules for the writing, in order of importance:

1. **State the sample limit in the first 100 words.** "Five questions cannot
   establish calibration; they can establish disagreement, and the disagreement
   is the finding." Say it before the leaderboard, not in a footnote.
2. **Lead with the disagreement, not the ranking.** With n=5 the ranking is
   noise. Where entrants diverged most is signal, and it is the thing the
   customer cannot get anywhere else.
3. **Name where the map diverged from the price.** If their dashboard said 90%
   and the field said 35%, that sentence is the entire value of the engagement.
4. **One recommendation, stated as a decision rule.** "Route pricing questions
   to X; do not let Y decide alone above $50k of exposure." Not "further study
   is warranted."
5. **No claim the data doesn't support.** If the result is "everything landed
   within noise of each other," write that. A customer who catches one
   overstatement discounts every other number in the document, and the honesty
   is the product.

## Phase 7 — Readout call (30 min)

15 minutes on the report, 15 on the question that comes next. The Uptick
transition, if it is real, is one sentence and it goes at the end:

> "The pattern in question 3 is the same one we look for in a full assessment —
> where the internal number and the outside number stopped agreeing and nobody
> noticed. If you want, I'll show you what that looks like across the whole
> roadmap rather than five questions."

Do not pitch during the report. Deliver the thing they bought, well, and let the
next step be theirs.

---

## What to do when it goes wrong

| Situation | Response |
|---|---|
| A question can't be resolved | Drop it, say so in writing, score the rest, note it in the report |
| Customer disputes an outcome | Resolution source was agreed in Phase 1 — reread it together. If it's genuinely ambiguous, drop the question and refund 20% |
| An entrant's API fails mid-run | Rerun once. If it fails again, note it as a DNF on the board; do not substitute a different model |
| Customer wants live/rolling updates | Not in this version. Offer the Standing Arena tier |
| Customer wants real-money betting | No. Not now, not for $10k |
| Report shows their model is bad | Say it plainly. That is what they paid for, and it is the version of this call that generates a referral |
| Three tournaments already running | Quote a start date 3 weeks out, or raise the price. Never compress the process |
