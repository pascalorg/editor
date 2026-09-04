# Library-craft lessons: lodash/es-toolkit/remeda, Drizzle ORM, FFmpeg

Multi-agent web research pass 2026-07-09. Claims are agent-reported and worth
re-verifying against primary sources before acting on any specific claim.
Subjects: lodash (and successors lodash-es, es-toolkit, remeda), Drizzle ORM
v0.45.3, FFmpeg (FATE infrastructure, checkasm, filter graph, deprecation
protocol). Each section distils what those projects do well, what failed, and
what lingo should take.

## lodash lineage: per-function modularity, size/perf marketing, naming algebra

**Context**: lodash (60M+ weekly downloads) earned adoption through API naming
consistency (300+ functions with predictable suffix/prefix families:
-By/-With/-In/is-/to-) and one-function-per-page documentation. Its downfall:
pre-ESM packaging made tree-shaking impossible (24 kB gzip for one function),
600+ per-method npm packages fragmented without codemods, and the lodash-es
migration stalled. es-toolkit (Toss, 2024) fixed this with `sideEffects:false`,
per-function files, Vitest `bench()` proving 2-3x perf and up to 97% smaller
bundles function-by-function, plus a compat layer for painless migration. Remeda
added TypeScript-first dual-paradigm APIs with structured JSDoc
(`@signature`/`@example`/`@category`) driving auto-generated docs.

**Lessons for lingo**:

1. **Benchmark-driven size/perf marketing per entry point.** es-toolkit ships
   `benchmarks/performance/` with per-function head-to-head results published on
   the site. Lingo already measures its own throughput (`bench/baseline-node.json`)
   and entry-point size (`scripts/size.mjs`). The gap is comparative numbers
   against chrono-node, convert-units, and ms on shared inputs, surfaced in docs.
   (agent-researched, 2026-07-09)

2. **Per-function docs pages with runnable examples.** Lodash, es-toolkit, and
   Remeda all guarantee every exported function gets its own searchable page.
   Lingo already has TSDoc `@example` on every public symbol (143+ verified) but
   the site aggregates them on a single long page. Per-function routes for the
   top-20 exports would improve discoverability. (agent-researched, 2026-07-09)

3. **Systematic suffix/prefix naming families.** Lodash: -By/-With/-Deep/-Right.
   Lingo already has verb-first families (parse*, humanize*, convert*, register*,
   define*, is*) documented in `wiki/conventions.md`, plus established suffixes
   -Delta (convertDelta) and -Range (parseRange). Formalizing this as a naming
   algebra in `wiki/api-design.md` prevents ad hoc names on future additions.
   (agent-researched, 2026-07-09)

4. **Per-entry size badges in published docs.** es-toolkit measures each
   function individually with esbuild min+gzip and publishes the numbers. Lingo
   already measures identically via `scripts/size.mjs`; the data just needs to be
   piped to a JSON file the docs site renders. (agent-researched, 2026-07-09)

5. **Compat-layer migration on-ramp from incumbents.** es-toolkit ships
   `es-toolkit/compat` accepting lodash's signature. A future
   `@pascal-app/lingo/compat/chrono` accepting chrono-node's `parse()` signature
   would lower the adoption barrier. Even migration recipes in docs (without code)
   would capture intent. (agent-researched, 2026-07-09)

6. **Inline JSDoc as the single source for docs generation.** Remeda generates
   its site from `@signature`/`@example`/`@category`. Lingo could add `@category`
   and `@since` tags, then wire `scripts/gen-docs-catalog.mjs` to emit the
   site's nav structure mechanically. (agent-researched, 2026-07-09)

## Drizzle ORM: zero-dep schema-as-types, multi-library bridge, dev/runtime split

**Context**: Drizzle ORM (v0.45.3, 35.1k stars) is a zero-dependency TypeScript
ORM (~7.4 kB min+gzip) whose core insight is that schema declarations *are* the
type system. Column builders progressively narrow types via branded intersection
helpers (`NotNull<T>`, `HasDefault<T>`); `$inferSelect`/`$inferInsert` derive
exact model types from accumulated builder state with zero runtime cost. Dev
tooling (`drizzle-kit`) never enters the production bundle. Multi-validation
bridges (`drizzle-zod`, `drizzle-valibot`, `drizzle-typebox`, `drizzle-arktype`)
emit target-library schemas from a single source.

**Lessons for lingo**:

1. **`$inferInput`/`$inferOutput` type accessors on LingoField.** Drizzle
   exposes `typeof table.$inferSelect` and `$inferInsert` from one schema. Lingo
   fields could expose `typeof field.$inferOutput` (canonical value: number or
   QuantityJSON) and `$inferInput` (string — what models emit). Purely
   type-level, zero runtime cost. Directly serves plan 027's literal-typed
   ecosystem. (agent-researched, 2026-07-09)

2. **Branded intersection helpers for progressive type narrowing.** Drizzle
   chains `.notNull()`, `.default()`, `.$type<T>()` where each returns a builder
   with an additional branded property. Lingo's `quantityField` currently uses
   flat option overloads; a builder pattern could refine the Output type parameter
   progressively. (agent-researched, 2026-07-09)

3. **Multi-validation-library bridge from a single schema.** `drizzle-zod` etc.
   iterate columns and emit target-library schemas. Lingo's `lingoObject` could
   adopt the conditions-pattern to emit Zod/Valibot schemas for consumers who
   need them — as optional peer-dep adapters, not new runtime deps.
   (agent-researched, 2026-07-09)

4. **Dev-tooling separation: heavy introspection never enters prod.** Drizzle's
   `drizzle-kit` is devDeps-only. Lingo's JSON Schema generation functions
   (`quantityJsonSchema`, `quantityRangeJsonSchema`) are only needed at
   tool-definition time. Marking them `/* @__PURE__ */` would help bundlers
   eliminate them when only `.parse()` is used at runtime.
   (agent-researched, 2026-07-09)

5. **`const`-generic identity helpers for literal preservation.** Drizzle's
   `pgTable('name', { columns })` preserves literal column names via `<const T>`.
   Lingo already uses this in `defineKind`; extending it to `lingoObject`'s shape
   parameter (`<const S extends LingoObjectShape>(shape: S)`) would give exact
   key unions on `InferLingoObject`. (agent-researched, 2026-07-09)

6. **`(string & {})` escape hatch for literal types with dynamic fallback.**
   Lingo already applies this on `Kind`. The audit notes that
   `QuantityFieldOptions.unit` is typed as plain `string` — it should be
   `UnitRefByKind<K> | (string & {})` for autocomplete on known units while
   accepting custom registry units. (agent-researched, 2026-07-09)

## FFmpeg: FATE-level regression discipline, fuzz/differential testing, pipeline formalism

**Context**: FFmpeg maintains 5,500+ automated FATE tests with 4,800+ reference
fixture files enforcing exact-output regression detection across 100+ platform/
compiler configurations. `checkasm` provides per-function cycle-level
micro-benchmarking. The filter graph is a composable pipeline of uniform
`AVFilter` interfaces. A strict versioned deprecation policy (`FF_API_*` guards,
major-bump-only removal) keeps the CLI/library surface coherent.

**Lessons for lingo**:

1. **CI-blocking corpus regression with additive/breaking classification.**
   FATE blocks on any reference mismatch; regeneration is explicit (`GEN=1`).
   Lingo's `corpus-diff.mjs` already classifies ADDITIVE vs BREAKING. The gap is
   growing corpus breadth (currently ~300 entries; FFmpeg covers every codec) and
   adding it as a blocking CI step. (agent-researched, 2026-07-09)

2. **Fuzz testing the parser with coverage-guided inputs.** FFmpeg integrates
   with OSS-Fuzz (3 sanitizers, 120+ targets). Lingo's `hostile.test.ts` covers
   38 hand-written adversarial cases; a lightweight fuzz harness (random/mutated
   UTF-16 strings, asserting never-throw + finite-values + linear-time) on
   nightly CI would catch normalizer/tokenizer edge cases. Aligns with plan 010
   layer 2. (agent-researched, 2026-07-09)

3. **Differential testing: parse(format(x)) round-trip oracle.** FATE's
   enc_dec_pcm pattern encodes then decodes and compares. Lingo's two-way
   guarantee (hard rule 4) is tested per-case but not systematically exhausted.
   A property-based oracle — for every bench corpus value call `format()` then
   `parse()` and assert `base` equality within epsilon — catches format/parse
   desync automatically. This is the seeded property round-trip test plan 010
   spec'd but has not yet shipped. (agent-researched, 2026-07-09)

4. **Benchmark baseline comparison in CI with regression threshold.** FFmpeg's
   `checkasm --compare` detects perf regressions above a threshold. Lingo's
   `bench.mjs` already has `--write-baseline` and `--compare --threshold 30`.
   The gap is checking in a `bench/baseline-node.json` on a stable runner and
   making it a CI gate. (agent-researched, 2026-07-09)

5. **Hostile-input latency probes as CI gates.** FFmpeg's `checkasm` includes
   adversarial probes with resource limits. Lingo already has 3 latency probes
   (50k no-match, 20k unknown tail, 500-digit number). Promoting them to CI
   gates with wall-clock budgets prevents catastrophic backtracking from
   shipping. (agent-researched, 2026-07-09)

6. **Versioned deprecation guards for public API changes.** FFmpeg uses
   `FF_API_*` preprocessor guards tied to major versions. As lingo approaches
   1.0, adopting `@deprecated` JSDoc + a `LINGO_DEPRECATED_*` constant that
   emits a one-time dev-only `console.warn` (tree-shaken in prod) would give
   users clear migration windows without runtime cost. (agent-researched,
   2026-07-09)

7. **Formalize pipeline stages as a uniform interface.** FFmpeg's `AVFilter`
   contract (named pads, format negotiation, frame-based activation) allows
   arbitrary composition. Lingo's data flow (normalize, tokenize, grammar,
   result, format) already exists as stages but is not individually addressable
   by callers. Extracting a typed `Stage<In, Out>` interface would enable custom
   grammar rules, middleware, and per-stage testing. Large effort; deferred.
   (agent-researched, 2026-07-09)

## Cross-cutting themes

- **Zero runtime deps is validated.** Drizzle (~7.4 kB, 0 deps) and es-toolkit
  prove the strategy works at scale. Both projects make it a marketing point.
- **Size gates as a competitive wedge.** es-toolkit publishes per-function sizes;
  Drizzle separates dev tooling. Both validate lingo's `scripts/size.mjs` gate
  and entry-point architecture.
- **Property tests and round-trip oracles beat snapshot maintenance.** FFmpeg's
  enc_dec pattern and plan 010's spec converge on the same idea; lingo should
  ship it.
- **Naming predictability reduces docs burden.** Lodash's suffix families let
  devs predict API names before looking them up; lingo's verb-first families are
  already there, but documenting the algebra explicitly makes it self-reinforcing.
