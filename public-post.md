# Public post — drafts for LinkedIn, X, and a short blog

**One claim carries all three:** every frontier model tested was overconfident on
the outcomes it chose to act on, and how overconfident it was predicted how much
money it lost. It is true, it is reproducible from a public repo, and it is
falsifiable — which is why it will survive contact with a comment section.

**Do not** post a "AI can't predict the future" take. Every account in this space
has one. The finding is narrower and much more useful: *these models are
underconfident where they're obviously right and overconfident exactly where
they decide to act.*

---

## LinkedIn (primary — this is where Uptick's buyer is)

> I gave ten frontier models the same job for a hundred World Cup matches: read
> the fixture, commit to probabilities, place a quarter-Kelly bet against the
> real bookmaker line with the margin left in.
>
> 1,514 decisions later, one result stands out and it isn't the leaderboard.
>
> **Every single model was overconfident on the outcomes it chose to act on.**
> The field assigned an average 32% probability to the outcomes it staked on.
> Those outcomes happened 23% of the time. Fifteen entrants, all erring in the
> same direction.
>
> And it was almost the whole story on money: rank the models by that
> overconfidence gap and you've reproduced the P&L table (Spearman −0.90). Ten
> of fifteen finished below their starting bankroll. The worst lost 65%.
>
> Here's the part that would have surprised me a year ago. On their *most
> likely* pick, these models are **under**confident. Claude Opus 4.7 said 62%
> and was right 71% of the time. The error isn't a blanket inflation of
> confidence — it's concentrated in the low-probability outcomes a model talks
> itself into acting on. Which is the only range where a decision is expensive.
>
> An accuracy eval scores that model as sensible. A price scored ten of them
> into a loss.
>
> Two more things worth saying out loud:
>
> → **No AI beat the market.** Not one, over ~100 questions each. The de-vigged
> consensus line ran as a competitor and won.
>
> → **Newer wasn't better.** Qwen's newest release finished last on money —
> behind the version it replaced. GLM 5.2 finished behind GLM 4.6. One season,
> one domain, so I won't over-claim it. But if your upgrade path assumes the new
> version has better judgment, that's an assumption nobody is currently
> measuring.
>
> Everything's public and reproducible — scoring code, every locked forecast
> committed to git before its kickoff, settlements Merkle-proved on-chain:
> worldcup.uptick.fyi
>
> If you're standardising on a model this quarter, the question I'd want
> answered isn't "which is smartest." It's "where is this one confidently wrong,
> and what's that costing." That's the assessment we run at Uptick — happy to
> show you what it looks like on your stack.

**Post it with:** the standings table as an image (rank / entrant / Brier /
bankroll). Tables outperform link previews and it renders the honesty — the
market on top, everyone else below it.

---

## X / Twitter thread

**1/**
> Ten frontier models. One identical prompt per match. A hundred World Cup
> fixtures. Real bookmaker odds with the vig left in.
>
> 1,514 bets later, the most useful result isn't the leaderboard 🧵

**2/**
> Every model was overconfident on the outcomes it acted on.
>
> Assigned: 32%
> Happened: 23%
>
> Fifteen entrants. All fifteen wrong in the same direction.

**3/**
> That gap is nearly the entire P&L story.
>
> Rank the field by overconfidence, and you've reproduced the money table.
> Spearman −0.90.
>
> 10 of 15 finished down. Worst: −65%.

**4/**
> The shape is the interesting part.
>
> On their *modal* pick they're UNDERconfident.
> Claude Opus 4.7: says 62%, right 71%.
>
> The error lives in the longshots they talk themselves into.
> Which is the only place a decision costs money.

**5/**
> No AI beat the market. Not one.
>
> The de-vigged consensus line entered as a competitor and finished #1 with a
> Brier of 0.4271. Best model: 0.4376.

**6/**
> Newer ≠ better calibrated.
>
> Qwen 3.7 Max: 344.55 units
> Qwen3 Max (the version it replaced): 1,028.44
>
> GLM 5.2 also finished behind GLM 4.6.
>
> One season, one domain — but nobody's measuring this at all.

**7/**
> All of it is reproducible. Scoring code is open, every forecast was committed
> to git before its kickoff, 80 settlements are Merkle-proved against an
> on-chain root.
>
> worldcup.uptick.fyi
>
> Full report: [link to sample-report]

**8/**
> If you're picking a model to standardise on this quarter — the question isn't
> which is smartest. It's where it's confidently wrong, and what that costs.
>
> That's what we measure at Uptick. DMs open.

---

## Short blog post (uptick.systems/writing) — outline

**Title:** *Your model is underconfident where it's right and overconfident
where it acts*

**Subtitle:** What 1,514 paper bets against a real betting market showed about
frontier model judgment.

1. **The setup** — 10 models, identical prompt, 104 events, real odds, vig left
   in, everything locked before kickoff and committed to git. (3 paragraphs)
2. **The leaderboard, briefly** — the market wins, nobody beats it. Get this out
   of the way; it isn't the point. (2 paragraphs + table)
3. **The finding** — 32% assigned / 23% realised, all fifteen entrants, Spearman
   −0.90 against P&L. (4 paragraphs + the gap-vs-bankroll table)
4. **Why the shape matters** — underconfident on modal picks, overconfident on
   acted-on outcomes; why accuracy evals miss it entirely; why it maps directly
   onto how an org uses a model. (4 paragraphs)
5. **The upgrade inversion** — Qwen, GLM. State the limits honestly: one season,
   one domain, a handful of version pairs. (3 paragraphs)
6. **What I'd want if I were choosing a model** — the decision rule, not the
   ranking. (2 paragraphs)
7. **Reproduce it** — repo, commands, an invitation to find an error. (1 paragraph)
8. **CTA** — one line to the Uptick assessment. (1 line)

**Length:** ~1,200 words. Ship the sample report as the canonical link; the post
is distribution for it.

---

## Distribution checklist

- [x] **Install PostHog on worldcup.uptick.fyi first.** Shipped 2026-08-30 and
      verified against the live domain. Whatever this post drives will be
      counted.
- [ ] Add a UTM to every link (`?utm_source=linkedin&utm_campaign=brier-report`)
      so leads are attributable to this and not to `$direct`.
- [ ] Publish `sample-report.md` as a page at `arena.uptick.fyi/report` — the
      social post links to the report, the report links to the assessment.
- [ ] LinkedIn first, Tuesday–Thursday morning. X same day.
- [ ] Post to r/slatestarcodex, LessWrong, or the EA Forum **only** if the write-up
      is the honest version with the caveats intact — that audience will check
      the repo, and if it holds up they are the highest-quality distribution
      available for this specific claim.
- [ ] **Reply to every substantive comment within 2 hours.** Comment replies are
      where the leads actually come from; the post is just what starts them.
- [ ] Log every inbound DM in the `brier-zero-log.md` tracking table, including
      the ones that go nowhere.

## What "it worked" looks like

| Signal | Threshold |
|---|---|
| Real engagement | 20+ substantive reactions or 5+ non-trivial comments |
| Qualified inbound | **1+ DM or reply from someone with a live model-selection decision** |
| Attributable traffic | 100+ visits to the report with the campaign UTM |
| The one that counts | **1 Uptick assessment booked** |

Anything less than *any* of these across 14 days is the Iteration 2 kill
condition, and it should be called on time rather than extended.
