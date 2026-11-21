[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/WhiskySix69/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/WhiskySix69/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every input (`{columns, rows, errors}`), but
reads the text with `indexOf` jumps and a whole-line fast path instead of one
character at a time. `main.ts` is the program the harness runs: it reads every
case from `/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

Entry for [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121) on make.fun.
