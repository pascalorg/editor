/**
 * Bench harness for compiled per-kind node parsers (`z.compile`).
 *
 * Answers the four questions the flag exists to settle:
 *
 * 1. Does a compiled per-kind parser beat the interpreter on a *monomorphic*
 *    call site (one kind, parsed over and over)?
 * 2. Does it still win on a *mixed* call site (all 48 kinds in one loop), and
 *    how does it compare to the design this rejects — one compiled function for
 *    the whole union?
 * 3. What does the first parse of a kind cost (codegen), and what does keeping
 *    1 / 5 / 48 kinds compiled cost in RSS?
 * 4. What do the wired call sites actually gain end to end?
 *
 * Run via:
 *   bun run packages/core/src/schema/__bench__/node-parsers.bench.ts
 *
 * Every section runs in its own child process. Compiling is irreversible within
 * a process and a large generated function measurably perturbs everything timed
 * after it — sharing one process moved these numbers by more than 10x run to
 * run. `--section <name>` is that child mode.
 */

import { z } from 'zod'
import { authoredNodeSchemas, NODE_KINDS, nodeFixtures } from '../__fixtures__/node-fixtures'
import {
  compiledNodeSchema,
  enableCompiledNodeParsers,
  nodeSchemaForKind,
  parseNode,
} from '../compiled-node-parsers'
import { AnyNode, type AnyNodeOption, type AnyNodeType } from '../types'

const ITERATIONS = 10_000

/** µs per operation, after a warm-up pass that lets the JIT settle. */
function measure(run: () => void, iterations = ITERATIONS): number {
  for (let i = 0; i < Math.min(2000, iterations); i++) run()
  const started = performance.now()
  for (let i = 0; i < iterations; i++) run()
  return ((performance.now() - started) / iterations) * 1000
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
  return { min: round(sorted[0] ?? 0), p50: round(at(50)), p95: round(at(95)), max: round(at(100)) }
}

function optionsByKind(): Map<AnyNodeType, AnyNodeOption> {
  return new Map(AnyNode.options.map((option) => [option.shape.type.value, option]))
}

/**
 * A parse that *fails* runs the compiled fast path and then the interpreter, so
 * an invalid fixture understates the win. Assert the batches are clean rather
 * than measure the fallback by accident.
 */
function assertParses(label: string, nodes: unknown[]): void {
  for (const node of nodes) {
    if (AnyNode.safeParse(node).success) continue
    throw new Error(`${label}: fixture does not satisfy AnyNode — bench would measure the fallback`)
  }
}

// ── sections ────────────────────────────────────────────────────────────────

function monomorphic() {
  const fixtures = nodeFixtures()
  const interpretedByKind = optionsByKind()

  // Every interpreted number is taken before the first `z.compile`, so no kind's
  // baseline is measured against a process already holding generated code.
  const baselines = NODE_KINDS.map((kind) => {
    const interpreted = interpretedByKind.get(kind) as AnyNodeOption
    const fixture = fixtures.get(kind)
    return {
      kind,
      union_us: round(
        measure(() => {
          AnyNode.safeParse(fixture)
        }),
      ),
      interpreted_us: round(
        measure(() => {
          interpreted.safeParse(fixture)
        }),
      ),
    }
  })

  enableCompiledNodeParsers()
  const rows = baselines.map((baseline) => {
    const compiled = nodeSchemaForKind(baseline.kind) as AnyNodeOption
    const fixture = fixtures.get(baseline.kind)
    const compiled_us = round(
      measure(() => {
        compiled.safeParse(fixture)
      }),
    )
    return {
      ...baseline,
      compiled_us,
      vs_interpreted: round(baseline.interpreted_us / compiled_us),
      vs_union: round(baseline.union_us / compiled_us),
    }
  })
  enableCompiledNodeParsers(false)

  return {
    rows,
    vs_union: summarize(rows.map((row) => row.vs_union)),
    vs_interpreted: summarize(rows.map((row) => row.vs_interpreted)),
  }
}

function mixed() {
  const fixtures = nodeFixtures()
  const interpretedByKind = optionsByKind()

  const inputs = NODE_KINDS.map((kind) => fixtures.get(kind))
  let cursor = 0
  const next = () => {
    cursor = (cursor + 1) % inputs.length
    return { kind: NODE_KINDS[cursor] as AnyNodeType, value: inputs[cursor] }
  }

  // Both interpreted baselines are timed before anything is compiled: 48
  // resident generated functions are enough instruction-cache pressure to slow
  // the interpreter down and flatter the compiled lane.
  const union_us = round(
    measure(() => {
      AnyNode.safeParse(next().value)
    }),
  )
  const interpreted_us = round(
    measure(() => {
      const { kind, value } = next()
      ;(interpretedByKind.get(kind) as AnyNodeOption).safeParse(value)
    }),
  )

  enableCompiledNodeParsers()
  const compiledByKind = new Map(
    NODE_KINDS.map((kind) => [kind, nodeSchemaForKind(kind) as AnyNodeOption]),
  )
  enableCompiledNodeParsers(false)

  return {
    union_us,
    interpreted_us,
    compiled_per_kind_us: round(
      measure(() => {
        const { kind, value } = next()
        ;(compiledByKind.get(kind) as AnyNodeOption).safeParse(value)
      }),
    ),
  }
}

/**
 * The control this design rejects: one compiled function for the whole union.
 * Runs alone because the generated code is large enough to perturb anything
 * timed alongside it.
 */
function compiledUnion() {
  const fixtures = nodeFixtures()
  const inputs = NODE_KINDS.map((kind) => fixtures.get(kind))
  let cursor = 0

  const compiled = z.compile(AnyNode)
  const started = performance.now()
  z.compile(AnyNode)
  const compileMs = performance.now() - started

  return {
    compile_ms: round(compileMs, 1),
    mixed_us: round(
      measure(() => {
        cursor = (cursor + 1) % inputs.length
        compiled.safeParse(inputs[cursor])
      }),
    ),
    monomorphic_wall_us: round(
      measure(() => {
        compiled.safeParse(fixtures.get('wall'))
      }),
    ),
  }
}

function compileCost() {
  const byKind = optionsByKind()
  const costs = NODE_KINDS.map((kind) => {
    const option = byKind.get(kind) as AnyNodeOption
    const started = performance.now()
    z.compile(option)
    return performance.now() - started
  })

  return {
    ...summarize(costs),
    total_all_48: round(
      costs.reduce((sum, value) => sum + value, 0),
      1,
    ),
  }
}

function rss(count: number) {
  const fixtures = nodeFixtures()
  enableCompiledNodeParsers()

  for (const kind of NODE_KINDS.slice(0, count)) {
    const schema = nodeSchemaForKind(kind) as AnyNodeOption
    schema.safeParse(fixtures.get(kind))
  }

  Bun.gc(true)
  return { count, rss: process.memoryUsage().rss }
}

function sites() {
  const fixtures = nodeFixtures()

  // Site A — the MCP bridge validates every `create` patch in a batch. Agents
  // usually omit `id` and let the schema default mint one, so fixtures do too.
  const CREATE_BATCH = 100
  const createBatch = Array.from({ length: CREATE_BATCH }, (_, index) => {
    const kind = NODE_KINDS[index % NODE_KINDS.length] as AnyNodeType
    const { id: _id, ...node } = fixtures.get(kind) as Record<string, unknown>
    return node
  })
  assertParses('site A', createBatch)

  // Site B — scene-load migration parses one authored schema per node kind it
  // normalizes. Six of them, each hit monomorphically.
  const MIGRATE_NODES = 100
  const authored = authoredNodeSchemas()
  const migrateKinds = ['door', 'window', 'stair', 'stair-segment', 'shelf', 'elevator']
  const migrateBatch = Array.from({ length: MIGRATE_NODES }, (_, index) => {
    const kind = migrateKinds[index % migrateKinds.length] as string
    return { kind, node: { ...(fixtures.get(kind as AnyNodeType) as Record<string, unknown>) } }
  })
  assertParses(
    'site B',
    migrateBatch.map(({ node }) => node),
  )

  // Site C — the store re-parses on every create and every update, so a drag
  // emits one parse per pointer move.
  const DRAG_MOVES = 200
  const dragNode = { ...(fixtures.get('wall') as Record<string, unknown>), id: 'wall_bench' }
  assertParses('site C', [dragNode])

  const siteA = () => {
    for (const node of createBatch) parseNode(node)
  }
  const siteB = () => {
    for (const { kind, node } of migrateBatch) {
      const schema = authored.get(kind)
      if (schema) compiledNodeSchema(schema).safeParse(node)
    }
  }
  const siteC = () => {
    for (let move = 0; move < DRAG_MOVES; move++) {
      parseNode({ ...dragNode, start: [move / 100, 0], end: [4 + move / 100, 0] })
    }
  }

  // Interpreted first: the flag is off, so every helper takes its current path.
  const interpreted = {
    a: measure(siteA, 200),
    b: measure(siteB, 200),
    c: measure(siteC, 100),
  }

  enableCompiledNodeParsers()
  siteA()
  siteB()
  siteC()
  const compiled = {
    a: measure(siteA, 200),
    b: measure(siteB, 200),
    c: measure(siteC, 100),
  }

  return [
    { site: `A: applyPatch, ${CREATE_BATCH} mixed creates`, ...pair(interpreted.a, compiled.a) },
    { site: `B: scene load, ${MIGRATE_NODES} migrated nodes`, ...pair(interpreted.b, compiled.b) },
    { site: `C: wall drag, ${DRAG_MOVES} updates`, ...pair(interpreted.c, compiled.c) },
  ]
}

function pair(interpreted: number, compiled: number) {
  return {
    interpreted_us: round(interpreted),
    compiled_us: round(compiled),
    speedup: round(interpreted / compiled),
  }
}

// ── child mode ──────────────────────────────────────────────────────────────

const sectionArg = process.argv.indexOf('--section')
if (sectionArg !== -1) {
  const name = process.argv[sectionArg + 1]
  const count = Number(process.argv[process.argv.indexOf('--count') + 1] ?? 0)
  const run: Record<string, () => unknown> = {
    mono: monomorphic,
    mixed,
    'compiled-union': compiledUnion,
    'compile-cost': compileCost,
    rss: () => rss(count),
    sites,
  }
  const section = run[name ?? '']
  if (!section) throw new Error(`unknown section "${name}"`)

  console.log(JSON.stringify(section()))
  process.exit(0)
}

// ── parent ──────────────────────────────────────────────────────────────────

function child<T>(args: string[]): T {
  const proc = Bun.spawnSync(['bun', 'run', import.meta.path, ...args])
  if (proc.exitCode !== 0) {
    console.error(proc.stderr.toString())
    throw new Error(`bench child ${args.join(' ')} exited ${proc.exitCode}`)
  }
  const out = proc.stdout.toString().trim()
  return JSON.parse(out.slice(out.lastIndexOf('\n') + 1))
}

console.log(`[bench] zod ${z.core.version.major}.${z.core.version.minor}.${z.core.version.patch}`)
console.log(`[bench] ${NODE_KINDS.length} node kinds, ${ITERATIONS} iterations per measurement`)
console.log('[bench] one child process per section\n')

const mono = child<ReturnType<typeof monomorphic>>(['--section', 'mono'])
console.log('── 1. warm monomorphic parse (µs/parse, one kind per call site) ──')
console.table([...mono.rows].sort((a, b) => b.union_us - a.union_us).slice(0, 12))
console.log('speedup vs union parse:', mono.vs_union)
console.log('speedup vs per-kind interpreted:', mono.vs_interpreted)

const mixedResult = child<ReturnType<typeof mixed>>(['--section', 'mixed'])
const unionResult = child<ReturnType<typeof compiledUnion>>(['--section', 'compiled-union'])
console.log('\n── 2. mixed all-48-kinds loop (µs/parse, megamorphic call site) ──')
console.table([
  {
    ...mixedResult,
    compiled_union_us: unionResult.mixed_us,
    per_kind_vs_union: round(mixedResult.union_us / mixedResult.compiled_per_kind_us),
    per_kind_vs_compiled_union: round(unionResult.mixed_us / mixedResult.compiled_per_kind_us),
  },
])
console.log('compiling the union instead of per kind:', unionResult)

console.log('\n── 3. first-parse compile cost per kind (ms) ──')
console.log(child(['--section', 'compile-cost']))

const rssRows: { kinds_compiled: number; rss_mb: number; delta_mb: number }[] = []
let baseline = 0
for (const count of [0, 1, 5, NODE_KINDS.length]) {
  const result = child<{ rss: number }>(['--section', 'rss', '--count', String(count)])
  if (count === 0) baseline = result.rss
  rssRows.push({
    kinds_compiled: count,
    rss_mb: round(result.rss / 1024 / 1024, 1),
    delta_mb: round((result.rss - baseline) / 1024 / 1024, 1),
  })
}
console.log('\n── 4. RSS after compiling N kinds (fresh process each) ──')
console.table(rssRows)

console.log('\n── 5. wired call sites, end to end (µs per batch) ──')
console.table(child(['--section', 'sites']))
