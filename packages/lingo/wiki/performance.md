# Performance benchmarking

Captured results live in [benchmarks.md](benchmarks.md) (first run 2026-07-03;
D17 suggestion-path pruning 2026-07-04). This page is the workflow: how to run
the suites and read the output.

Lingo benchmarks are designed to answer two product questions:

- Will this parser affect a frontend input field while the user types?
- Can a backend safely parse large batches without surprising CPU cost?

The answer should come from the built package in `dist/`, because that is what
real consumers import.

## Commands

Build first, then run the backend benchmark:

```sh
bun run build
bun run bench
```

Run the real-browser benchmark:

```sh
bun run build
bun run bench -- --browser --open
```

Without `--open`, the script prints a local URL. Open it in the browser you want
to measure; the page posts results back to the terminal.

Write or compare a local backend baseline:

```sh
bun run bench -- --write-baseline bench/baseline-node.json
bun run bench -- --compare bench/baseline-node.json --threshold 30
```

Use baselines only on the same class of machine and runtime. Shared CI runners
are useful for reports, not for tight absolute gates.

## What the script measures

Backend Node suites:

- simple `parseQuantity()` calls
- mixed `lingo()` grammar paths
- `partialState()` typing checks
- date and duration parsing with explicit `now`
- formatting and humanizing
- slow paths: typo fix, unknown-unit suggestions, strict confirm/candidate mode,
  free-text scanning
- one-shot latency probes for long no-match and hostile-ish inputs

Browser suites:

- mixed parse paths in the browser engine
- frontend typing via `partialState()`
- date/duration parsing and humanizing
- DOM controller `field.set()` / commit behavior on a real `<input>`
- browser long-input latency probes

## How to read results

Normal parser paths should be discussed in ops/s and µs/op. Latency
probes should be discussed in milliseconds per single call.

Unknown-unit suggestions are expected to be slower than ordinary parses because
they rank edit-distance candidates across aliases. That is acceptable for user
feedback. For backend bulk validation where suggestions are not shown, use:

```ts
const result = lingo(input, {
  kind: 'mass',
  strictness: 'strict',
  tolerance: { typos: 'off' },
})
```

That measures the validation path rather than did-you-mean generation.

## Backend integration pattern

Reuse option objects, pass explicit `now` for dates, and disable suggestion work
when it is not part of the product surface:

```ts
import { lingo } from '@pascal-app/lingo'
import { parseDate } from '@pascal-app/lingo/date'

const quantityOptions = {
  kind: 'mass',
  strictness: 'strict',
  tolerance: { typos: 'off' },
} as const

export function parseImportRows(rows: Array<{ weight: string; due: string }>) {
  const now = new Date('2026-07-03T12:00:00Z')
  return rows.map((row) => ({
    weight: lingo(row.weight, quantityOptions),
    due: parseDate(row.due, { now, strictness: 'strict' }),
  }))
}
```

## Frontend integration pattern

Use `partialState()` or the DOM controller for typing feedback; keep canonical
values out of display text until commit:

```ts
import { lingoInput } from '@pascal-app/lingo/dom'

const field = lingoInput(document.querySelector<HTMLInputElement>('#height')!, {
  kind: 'length',
  unit: 'm',
  name: 'height_m',
  debounce: 150,
  validationBehavior: 'aria',
  errorElement: '#height-error',
  hintElement: '#height-hint',
})

field.set(`5'11"`)
field.value // 1.8034
```

The browser benchmark exercises this path on a real input element.

## Production-grade checklist

- Keep `bun run size` and `bun run bench` separate: size is a hard package budget,
  benchmarks are runtime evidence.
- Publish benchmark numbers with package version, runtime, machine class, command,
  and whether typo suggestions were enabled.
- Treat backend batch parsing and frontend field parsing as separate promises.
- Investigate any broad regression before tuning a single suite; many suites share
  normalization, tokenization, and unit matching.
- Keep hostile long-input tests in Vitest so pathological complexity remains a
  normal correctness gate.
