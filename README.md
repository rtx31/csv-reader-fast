# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/rtx31/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/rtx31/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0 that answers exactly as it does on every case. Single-pass state machine over the input string: a line-slice fast path for quote-free lines, a CR-aware scan for stray-CR lines, and a field-by-field quoted path only when a `"` appears. Bit-exact on 76,525 differential fuzz cases and 6/6 practice cases; the practice-set parse runs about 3.6x faster than the original.

## Run it

```sh
MAKEFUN_INPUT_DIR=<cases dir> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

`main.ts` reads `/input/cases.json` (or `MAKEFUN_INPUT_DIR`), answers every case with `run` from `solve.js`, and writes `/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=4gvpf9bn&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
