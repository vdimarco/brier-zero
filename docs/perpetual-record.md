# The perpetual record

The World Cup gave this repo 104 questions and then ended. This is the part
that does not end.

## Why this and not more of the last thing

Three facts, all checked in August 2026, and all of them constrain the design:

1. **Models reached superforecaster parity.** ForecastBench reports parity as
   of [16 July 2026](https://forecastingresearch.substack.com/p/ai-models-have-likely-reached-parity),
   with market-question parity estimated for August. "Models will get better"
   is history, not a forecast.
2. **The calibration finding is already published.**
   [PolyBench](https://arxiv.org/html/2604.14199v1) ran 36,165 timestamp-locked
   predictions on Polymarket in February and found that five of seven models
   lost money "despite uniformly high stated confidence".
   [Prediction Arena](https://arxiv.org/html/2604.07355v1) ran 57 days of live
   and paper trading. Publishing that result as news would be a rediscovery.
3. **Both of those stop.** PolyBench covers six days. Prediction Arena covers
   57. Papers end, because publishing is not operating.

What nobody is doing is running it continuously. That gap is the whole design,
because a forecast record has one property a paper cannot buy later: **you
cannot backfill it.** A competitor starting tomorrow cannot produce a locked,
timestamped forecast for yesterday. Every week this runs, that advantage grows
and cannot be caught up.

## What it measures

The crossover. Models now match superforecasters; they do not yet beat a
price net of the spread. Over the next year that may flip. Whoever holds a
pre-committed, tamper-evident record on the day it flips owns the receipt.

The asset pays out either way:

- **If it flips**, this is the dated proof of when, and the first place anyone
  can check it.
- **If it never flips**, this is the longest continuous evidence that a market
  still beats the machines, which is the argument Uptick already sells.

## How it works

```
Kalshi open markets  ->  eligibility filter  ->  N new questions per run
                                                        |
                    every entrant, one identical prompt, no price shown
                                                        |
                            locked forecast + git commit (the timestamp)
                                                        |
                     market resolves on its own schedule  ->  settle + score
```

Binary contracts settle at 100¢ or 0¢, so a price in cents is an implied
probability with no de-vigging needed. Two numbers come off each book:

| Number | Used for |
|---|---|
| Midpoint of bid/ask | The Market's own forecast, Brier-scored as an entrant |
| The ask | What a bet actually costs, so the paper bankroll keeps the spread in |

That mirrors the football rules exactly: the leaderboard scores the fair line,
the bankroll settles at the price you would really pay.

## The rules that make it a record rather than a dataset

- **The prompt never contains the price.** A model shown the line scores well
  by copying it. `test/questions.test.js` asserts this and fails on any leak.
- **Every entrant gets identical words.** No per-model tailoring, ever.
- **A locked forecast is never overwritten.** Only failures are retried.
- **The question text is fixed once asked.** Only price, status and outcome move.
- **File-backed, not database-backed.** A database write is not a timestamp
  anyone can check. A commit is. `data/store.json` is committed after every run.

## Eligibility

Named in one place (`ELIGIBILITY` in `lib/kalshi.js`) because these thresholds
shape the record for years:

| Filter | Default | Why |
|---|---|---|
| `minHoursToClose` | 24 | Nothing that resolves tonight |
| `maxDaysToClose` | 120 | Nothing unresolvable for years |
| `maxSpread` | 0.10 | A wider book holds no opinion worth scoring |
| `minVolume` | 100 | Thin markets are noise, not a baseline |

The spread filter also catches the trap where an empty book (0 bid, 100 ask)
midpoints to a confident-looking 0.5. The probability alone cannot tell you
that; the spread can.

## Running it

```bash
npm run probe:kalshi     # once, from a networked shell — see the caveat below
npm run collect          # the cron: enter new questions, lock forecasts
npm run settle           # score whatever resolved since last time

DEMO_MODE=1 npm run collect -- --fixture test/fixtures/kalshi-markets.json
```

Then commit `data/store.json`. The commit is the lock.

## Scheduling it

`.github/workflows/perpetual-record.yml` is the unattended version. Settlement
runs daily and costs nothing but a Kalshi read; collection runs Mondays and is
the only step that spends. The job commits `data/store.json` itself, because
the commit timestamp is the whole proof — a record you have to remember to
push is not a record.

Two things it needs that the file cannot give itself:

1. **An `OPENROUTER_API_KEY` repository secret.** The collect step checks for
   it and fails loudly rather than committing a week of empty forecasts.
2. **The code has to be on the default branch.** GitHub fires `schedule` only
   there. Until this workflow and `lib/kalshi.js` reach the default branch,
   the cron will not run on its own — `workflow_dispatch` still works from any
   branch, so you can drive it by hand in the meantime.

Optionally set a `KALSHI_API` repository variable to point the adapter at a
different host; unset, it uses the default.

One consequence worth knowing: questions live inside `data/store.json`
alongside the World Cup ledger, so each weekly run rewrites a 1.5 MB file.
Git deltas it well, but if the record runs for years, splitting the questions
into their own file is the cheap fix.

## What costs what

Upper bound, charging all 12 entrants at Claude Opus 5 list rates
($5/$25 per MTok), ~800 tokens in and 250 out per forecast:

| Cadence | Forecasts/yr | Upper bound |
|---|---|---|
| 20 questions/week | 12,480 | $128/yr |
| **30 questions/week** | **18,720** | **$192/yr** |
| 30/week, re-priced weekly for 4 weeks | 74,880 | $768/yr |

The real roster runs cheap-to-frontier through OpenRouter, so actual spend
lands below that. Braintrust Pro is $249 a month.

## Known gap

`lib/kalshi.js` was written against Kalshi's documented market object and
**has not been checked against a live response.** Outbound HTTPS to
`api.elections.kalshi.com` is blocked from the machine that wrote it. The
adapter is defensive (missing fields return null rather than throw) and every
pure function is fixture-tested, but field names need one real check before
the cron is trusted. `npm run probe:kalshi` does exactly that and names any
field the adapter expects and does not find.

Retried 2026-08-30 and still blocked, this time with the reason visible: the
agent proxy answers `403` to the `CONNECT` for `api.elections.kalshi.com:443`,
so the request never reaches Kalshi at all. That is a network policy on this
machine, not a fault in the adapter and not a signal about the API. It still
has to be run somewhere with real egress before the cron is trusted.
