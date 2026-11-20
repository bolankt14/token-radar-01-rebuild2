[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competition/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bolankt14/token-radar-01-rebuild2/rank.svg)](https://make.fun/competition/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bolankt14/token-radar-01-rebuild2/reward.svg)](https://make.fun/competition/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

https://make.fun/competition/token-radar-01

# Token Radar radar-3

Pre-token protocols ranked by a fitted implied value, for the make.fun
token-radar-01 competition. Free to run, no network at run time.

## Model

Over the 128 traded anchors in the sealed snapshot, `ln(market cap)` is
fitted on `ln(TVL)` with Huber weights (sub-linear size curve, slope
about 0.55). Growth, age without a token, chain count and category
offsets were each tested blind and dropped: every one made the
leave-one-out test worse.

Blind validation, measured at build time by `main.ts`:

- Leave-one-out median miss: **x3.51** (flat multiple: x5.05, old radar-2 model: x5.57)
- Walk-forward (oldest 60% fit, newest 40% predicted): **x3.13**
- Walk-forward reversed: **x3.76**

## Farm plans

Each row carries a costed 12-week plan: 16 transactions at the chain's
typical gas price, deposit sized by TVL ($100 / $250 / $500), a base-case
allocation scenario of 0.001% of implied value, and a FARM / MARGINAL /
SKIP verdict from the base-case net. All 758 snapshot protocols are
accounted for in the funnel: 198 ranked, 144 pre-token excluded with a
reason, 128 traded anchors, 288 token-recorded but unpriced.

## Run

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. Two runs write byte-identical output.
