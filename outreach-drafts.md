# Outreach — 10 targets, drafted messages, tracking

**Honest note on how this list is built:** I have not invented ten named people
with email addresses. Every target below is a real, publicly verifiable
organisation, community, or role-shape, with a stated reason they'd care and a
stated place to find the person. Nine of the ten need Vaughn to fill in one
name — that is a 30-minute LinkedIn pass, and it is the only step of Iteration 1
I cannot do from here. **Do that pass before sending anything**; a message
addressed to a company converts at zero.

**Send all ten inside one week.** Ten messages over three weeks is not a test,
it is a mood. The kill criterion (0 positive replies from 10 attempts) only
means something if the ten go out together and get a fair 10 working days.

---

## The list, ranked by expected reply rate

| # | Target | Where to find the person | Why they'd care | Lead offer |
|---|---|---|---|---|
| 1 | **Vaughn's own network — operators mid-AI-decision** | Your contacts. Anyone who has said "we're deciding between X and Y" in the last 90 days | Highest reply rate you will ever have; already trusts you; the calibration finding maps to a live decision | Calibration Audit $1,500 |
| 2 | **Uptick's past assessment clients & pipeline** | CRM / inbox | Warm, already bought judgment from you once; this is a smaller, faster second purchase | Season Pass $299 → Audit |
| 3 | **AI-native startups selling agents to enterprise** | Their founders post on LinkedIn/X about closing enterprise deals | They need a *third-party* credibility artifact for their own sales deck; the one thing they can't self-produce | Season Pass $299 |
| 4 | **YC / accelerator batch companies in the agent category** | Public batch directories; alumni intros | Fundraising, need differentiation, small fast budgets, founder decides in one email | Season Pass $299 |
| 5 | **Sports-analytics & betting-adjacent shops** | The World Cup board is native to them — they'll read it without being sold | Only audience that already understands "beat the de-vigged line" and needs no education | Audit $1,500+ |
| 6 | **[Metaculus](https://www.metaculus.com/aib/) bot-tournament entrants** | Public tournament leaderboards; the AIB community | Actively building forecasting bots; the market-baseline framing is genuinely new to them | Free comparison run → relationship |
| 7 | **[Vals AI](https://www.vals.ai/product)-shaped eval vendors** | Company sites, LinkedIn | *Partner, not customer.* They sell private benchmarks in regulated domains; the market-settled scoring is a complement to their rubric-based work | Partnership call |
| 8 | **VC associates covering AI/agents** | Fund websites, X | Won't pay, will circulate. Distribution for Iteration 2's report | Free report |
| 9 | **Think tanks / policy shops with forecasting programs** | Public research pages | Grant-funded and slow, but a logo | Free run, cite us |
| 10 | **The lab researchers who publish on forecasting** | Papers, X | **Lowest priority — near-zero WTP.** Metaculus pays them $50k/season and ForecastBench is free. Send last, expect nothing, treat any reply as credibility not revenue | Free run |

Targets 1–5 are the test. Targets 6–10 are there because the brief asked for
breadth, and I'd rather be explicit that half this list is not a revenue list
than pad it and let the result be misread.

---

## Draft A — warm operator (targets 1, 2). Highest priority.

> **Subject: your model is confident — I checked whether it's right**
>
> [Name] —
>
> I've been running something odd for the last few months: ten frontier models
> making the same forecasts against a real betting market, scored on a
> hundred-odd resolved events, all of it public and reproducible.
>
> Two results I didn't expect:
>
> **Every single model was overconfident, in the same direction.** Across 1,514
> decisions, they assigned an average 32% probability to the outcomes they chose
> to act on. Those outcomes happened 23% of the time. How overconfident each
> model was predicted almost exactly how much money it lost.
>
> And **the newer versions weren't reliably better** — Qwen's newest release
> finished last on money, behind the version it replaced. Same for GLM.
>
> Which made me think of [specific decision they're facing]. Accuracy evals
> won't catch this: these models are *underconfident* on their obvious calls and
> overconfident exactly where they decide to act, which is the only range that
> costs you anything.
>
> I've started running this privately — your models, your questions, scored the
> same way, one page back with a recommendation. $1,500, about three weeks.
>
> Worth 20 minutes? Happy to just send you the public board either way:
> [worldcup.uptick.fyi]
>
> Vaughn

**Why this shape:** the negative result is the hook and it's true, so it
survives scrutiny. No deck, no link-tree, one price, one ask, and a version of
"no" that still ends with them looking at the board.

---

## Draft B — agent builder / startup founder (targets 3, 4)

> **Subject: benchmarking [Company] against the frontier field**
>
> [Name] —
>
> I run Brier Zero — ten frontier models forecasting real events against a live
> betting market, Brier-scored, paper-traded, every forecast timestamped in a
> public repo before its resolution. No model has beaten the market yet, which
> is the most useful thing on the board.
>
> Want [Agent] on it?
>
> You'd get an independent scorecard: your agent vs. Claude, GPT, Gemini,
> DeepSeek, Kimi, Qwen, GLM, Grok, MiniMax and Mistral, same prompt, same
> scoring, plus where you're over- and under-confident. It's the kind of thing
> that's hard to say about yourself in a sales deck and easy when someone else
> ran it.
>
> $299 and about two weeks. If it goes badly for you, you keep the result and I
> don't publish it — that's your call, always.
>
> Vaughn · [worldcup.uptick.fyi]

**Why this shape:** "you control publication" removes the only real objection a
founder has, and costs nothing.

---

## Draft C — the brief's line, for cold sends (targets 5, 6)

> **Subject: private forecasting tournament — your model vs. the field**
>
> [Name] —
>
> I run a forecasting benchmark for AI agents — ten frontier models, one
> identical prompt per question, Brier-scored against real resolved events, and
> the de-vigged market line entered as a competitor. Over ~100 events the market
> is still winning.
>
> Want to test your model against the leaderboard in a private tournament?
> Your questions, your entrant, two weeks, one page back. $299.
>
> Board's here if you want to poke at the methodology first — the scoring code
> and every locked forecast are public: [worldcup.uptick.fyi]
>
> Vaughn

---

## Draft D — partnership, not sale (target 7)

> **Subject: market-settled scoring as a complement to rubric evals**
>
> [Name] —
>
> You sell private domain benchmarks; I've built something adjacent and I don't
> think we overlap. Brier Zero scores models against a *priced market* — the
> forecast has to beat a consensus line with the vig left in, and settlement is
> Merkle-proved on-chain so the record can't be quietly edited.
>
> It answers "is this model calibrated enough to bet on" rather than "does it
> match our rubric." I think that's a section in your reports, not a competitor
> to them.
>
> Worth a call?
>
> Vaughn

---

## Draft E — the "no ask" send (targets 8, 9, 10)

> **Subject: ten frontier models, one betting market, a hundred events**
>
> [Name] —
>
> No ask — thought you'd find this interesting.
>
> I ran ten frontier models as forecasters against real market odds for the
> World Cup: identical prompt, Brier-scored, paper-traded at quarter-Kelly,
> every forecast committed to git before kickoff and every settlement
> Merkle-proved on-chain.
>
> The market beat all ten. Every model was overconfident on the outcomes it
> chose to act on — 32% assigned, 23% realised, all fifteen entrants erring the
> same way — and how overconfident each was tracked its final P&L at Spearman
> −0.90. Newer versions were not reliably better: Qwen's and GLM's newest
> releases both finished behind their predecessors on money.
>
> Everything's reproducible: [worldcup.uptick.fyi]
>
> Vaughn

---

## Rules for sending

1. **Personalise line one or don't send.** One sentence proving you know what
   they're working on. Without it these are spam and the test measures nothing.
2. **Never claim we beat the market.** We don't. The board says so and someone
   will check.
3. **One follow-up, day 6, two sentences.** Then stop.
4. **A reply that isn't a sale is still a result.** "Interesting, not now" and
   "wrong domain for us" are data — log both.
5. **Sports framing is a feature for target 5 and a liability for targets 1–4.**
   For operators, lead with the calibration finding; the World Cup is the
   evidence, not the subject.

---

## Tracking table — fill this in as replies land

| # | Target | Person | Draft | Sent | Reply | Sentiment | Outcome |
|---|---|---|---|---|---|---|---|
| 1 | | | A | | | | |
| 2 | | | A | | | | |
| 3 | | | B | | | | |
| 4 | | | B | | | | |
| 5 | | | C | | | | |
| 6 | | | C | | | | |
| 7 | | | D | | | | |
| 8 | | | E | | | | |
| 9 | | | E | | | | |
| 10 | | | E | | | | |

**Sentiment:** `positive` = asked a follow-up question, requested a call, or
asked about price. `neutral` = acknowledged, no interest. `negative` = declined.
`none` = no reply after the day-6 follow-up.

**Decision rule (from the brief):** 3+ positive or 1 payment inside 14 days →
continue. **0 positive after all 10 have been sent and followed up → Iteration 1
is falsified, stop and move to Iteration 2.** Do not send an eleventh message
hoping for a different answer.
