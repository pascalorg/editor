import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { authoredNodeSchemas, NODE_KINDS, nodeFixtures } from './__fixtures__/node-fixtures'
import {
  compiledNodeParsersEnabled,
  compiledNodeSchema,
  enableCompiledNodeParsers,
  nodeSchemaForKind,
} from './compiled-node-parsers'
import { AnyNode, type AnyNodeOption, type AnyNodeType, nodeKindOf } from './types'

/**
 * The compiled lane is only safe if it is *invisible*: for every node kind a
 * compiled parser must return the same value on valid input and the same issues
 * on invalid input as the interpreted schema it clones. These tests assert that
 * across all 48 kinds, in both flag states, and under `jitless` (the CSP
 * profile) where compilation must silently decline.
 */

const fixtures = nodeFixtures()
const authoredByKind = authoredNodeSchemas()
const optionByKind = new Map<AnyNodeType, AnyNodeOption>(
  AnyNode.options.map((option) => [nodeKindOf(option), option]),
)

/** Mutations of a valid fixture that every kind rejects, via its `BaseNode` fields. */
function invalidVariants(fixture: Record<string, unknown>): { label: string; value: unknown }[] {
  return [
    { label: 'id: number', value: { ...fixture, id: 42 } },
    { label: 'visible: string', value: { ...fixture, visible: 'yes' } },
    { label: 'parentId: number', value: { ...fixture, parentId: 7 } },
    { label: 'metadata: string', value: { ...fixture, metadata: 'nope' } },
    { label: 'object: wrong literal', value: { ...fixture, object: 'not-a-node' } },
    { label: 'name: number', value: { ...fixture, name: 5 } },
    { label: 'root: null', value: null },
    { label: 'root: number', value: 42 },
    { label: 'root: array', value: [] },
  ]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep equality that also pins the own-key list, in order.
 *
 * `toEqual` ignores keys whose value is `undefined`, but the store depends on
 * their presence: `wall.height` and `stair.totalRise` encode a mode by key
 * absence, and `safeParse` echoing an explicit `key: undefined` is what
 * `mergeNodeUpdate`/`normalizeStairNode` compensate for. Key *order* is pinned
 * too so a compiled parser can't silently change a node's serialized form.
 */
function expectSameValue(actual: unknown, expected: unknown, path = '$'): void {
  if (isPlainRecord(expected)) {
    expect(isPlainRecord(actual), `${path}: expected a plain object`).toBe(true)
    const actualRecord = actual as Record<string, unknown>
    expect(Object.keys(actualRecord), `${path}: own keys`).toEqual(Object.keys(expected))
    for (const key of Object.keys(expected)) {
      expectSameValue(actualRecord[key], expected[key], `${path}.${key}`)
    }
    return
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: expected an array`).toBe(true)
    const actualArray = actual as unknown[]
    expect(actualArray.length, `${path}: length`).toBe(expected.length)
    for (const [index, item] of expected.entries()) {
      expectSameValue(actualArray[index], item, `${path}[${index}]`)
    }
    return
  }

  expect(Object.is(actual, expected), `${path}: ${String(actual)} !== ${String(expected)}`).toBe(
    true,
  )
}

describe('compiled node parsers — flag off', () => {
  test('is off by default', () => {
    expect(compiledNodeParsersEnabled()).toBe(false)
  })

  test('hands back the very schema it was given', () => {
    for (const kind of NODE_KINDS) {
      const authored = authoredByKind.get(kind)
      const option = optionByKind.get(kind)
      expect(compiledNodeSchema(authored as never)).toBe(authored)
      expect(nodeSchemaForKind(kind)).toBe(option)
    }
  })
})

describe('compiled node parsers — lookup contract', () => {
  test('returns null for anything the union does not discriminate on', () => {
    expect(nodeSchemaForKind('not-a-node')).toBeNull()
    expect(nodeSchemaForKind(undefined)).toBeNull()
    expect(nodeSchemaForKind(null)).toBeNull()
    expect(nodeSchemaForKind(42)).toBeNull()
    expect(nodeSchemaForKind({ type: 'wall' })).toBeNull()
    // A prototype key must not resolve to a schema.
    expect(nodeSchemaForKind('toString')).toBeNull()
    expect(nodeSchemaForKind('__proto__')).toBeNull()
  })

  test('covers every union kind', () => {
    const missing = NODE_KINDS.filter((kind) => nodeSchemaForKind(kind) === null)
    expect(missing).toEqual([])
  })
})

describe('compiled node parsers — flag on', () => {
  beforeAll(() => {
    enableCompiledNodeParsers()
  })
  afterAll(() => {
    enableCompiledNodeParsers(false)
  })

  test('is on', () => {
    expect(compiledNodeParsersEnabled()).toBe(true)
  })

  test('memoizes one compiled clone per schema', () => {
    const first = nodeSchemaForKind('wall')
    expect(nodeSchemaForKind('wall')).toBe(first)
    expect(first).not.toBe(optionByKind.get('wall'))
  })

  test('leaves the interpreted schema instance untouched', () => {
    const option = optionByKind.get('wall') as AnyNodeOption
    nodeSchemaForKind('wall')
    // `z.compile` clones; the original must still be the union's member.
    expect(AnyNode.options.includes(option)).toBe(true)
    expect(option.safeParse(fixtures.get('wall')).success).toBe(true)
  })

  test('every kind actually compiles', () => {
    // A kind that comes back identical means `z.compile` declined it. That is
    // safe but silently drops the whole point, so surface it here instead.
    const declined = NODE_KINDS.filter((kind) => nodeSchemaForKind(kind) === optionByKind.get(kind))
    expect(declined).toEqual([])
  })

  test.each(NODE_KINDS)('%s: compiled output matches interpreted', (kind) => {
    const interpreted = optionByKind.get(kind) as AnyNodeOption
    const compiled = nodeSchemaForKind(kind) as AnyNodeOption
    const fixture = fixtures.get(kind) as Record<string, unknown>

    const viaInterpreted = interpreted.safeParse(fixture)
    const viaCompiled = compiled.safeParse(fixture)

    expect(viaInterpreted.success).toBe(true)
    expect(viaCompiled.success).toBe(true)
    expectSameValue(viaCompiled.data, viaInterpreted.data)
  })

  test.each(NODE_KINDS)('%s: compiled errors match interpreted', (kind) => {
    const interpreted = optionByKind.get(kind) as AnyNodeOption
    const compiled = nodeSchemaForKind(kind) as AnyNodeOption
    const fixture = fixtures.get(kind) as Record<string, unknown>

    for (const { label, value } of invalidVariants(fixture)) {
      const viaInterpreted = interpreted.safeParse(value)
      const viaCompiled = compiled.safeParse(value)

      expect(viaInterpreted.success, `${kind} / ${label}: fixture must be rejected`).toBe(false)
      expect(viaCompiled.success, `${kind} / ${label}`).toBe(false)
      expect(viaCompiled.error?.issues, `${kind} / ${label}: issues`).toEqual(
        viaInterpreted.error?.issues,
      )
      expect(viaCompiled.error?.message, `${kind} / ${label}: message`).toBe(
        viaInterpreted.error?.message,
      )
    }
  })

  // Site A surfaces `error.message` to the MCP caller and sites A/C swap the
  // union parse for a per-kind parse, so the two must report failures the same.
  test.each(NODE_KINDS)('%s: per-kind errors match the union', (kind) => {
    const compiled = nodeSchemaForKind(kind) as AnyNodeOption
    const fixture = fixtures.get(kind) as Record<string, unknown>

    for (const { label, value } of invalidVariants(fixture)) {
      if (!isPlainRecord(value)) continue // a non-object root can only reach the union

      const viaUnion = AnyNode.safeParse(value)
      const viaCompiled = compiled.safeParse(value)

      expect(viaUnion.success, `${kind} / ${label}`).toBe(false)
      expect(viaCompiled.error?.issues, `${kind} / ${label}: issues`).toEqual(
        viaUnion.error?.issues,
      )
      expect(viaCompiled.error?.message, `${kind} / ${label}: message`).toBe(
        viaUnion.error?.message,
      )
    }
  })

  test.each(NODE_KINDS)('%s: compiled output matches the union', (kind) => {
    const compiled = nodeSchemaForKind(kind) as AnyNodeOption
    const fixture = fixtures.get(kind) as Record<string, unknown>

    expectSameValue(compiled.safeParse(fixture).data, AnyNode.safeParse(fixture).data)
  })

  // `normalizeStairNode` strips `totalRise` back off precisely because
  // `safeParse` echoes the explicit-undefined key it was handed. The compiled
  // parser has to echo it too, or absence would start meaning something else.
  test('echoes explicit-undefined keys like the interpreter', () => {
    const authored = authoredByKind.get('stair')
    if (!authored) throw new Error('no stair schema')
    const compiled = compiledNodeSchema(authored as never) as typeof authored

    const withUndefined = { ...(fixtures.get('stair') as Record<string, unknown>) }
    withUndefined.totalRise = undefined

    const viaInterpreted = authored.safeParse(withUndefined)
    const viaCompiled = compiled.safeParse(withUndefined)

    expect(viaInterpreted.success).toBe(true)
    expect(viaCompiled.success).toBe(true)
    expect('totalRise' in (viaInterpreted.data as object)).toBe(true)
    expectSameValue(viaCompiled.data, viaInterpreted.data)
  })

  // Site B compiles the *authored* schemas, whose discriminator keeps its
  // `.default()`, so `type` may be absent from the input.
  test.each(NODE_KINDS)('%s: authored schema compiles and fills its own type', (kind) => {
    const authored = authoredByKind.get(kind)
    if (!authored) throw new Error(`no per-kind schema exported for "${kind}"`)
    const compiled = compiledNodeSchema(authored as never) as typeof authored

    const typeless = { ...(fixtures.get(kind) as Record<string, unknown>) }
    delete typeless.type

    const viaInterpreted = authored.safeParse(typeless)
    const viaCompiled = compiled.safeParse(typeless)

    expect(viaInterpreted.success).toBe(true)
    expect(viaCompiled.success).toBe(true)
    expect((viaCompiled.data as { type?: string }).type).toBe(kind)
    expectSameValue(viaCompiled.data, viaInterpreted.data)
  })
})

describe('compiled node parsers — jitless (CSP) profile', () => {
  // `z.config({ jitless: true })` is the switch a CSP-restricted embedder sets,
  // and zod's `allowsEval` probe is one-shot per process — so this has to run in
  // a fresh one, with the config set before any schema module is imported.
  test('declines to compile and keeps parsing correctly', () => {
    const dir = import.meta.dir
    const source = `
      import { z } from 'zod'
      z.config({ jitless: true })

      const parsers = await import(${JSON.stringify(`${dir}/compiled-node-parsers.ts`)})
      const fx = await import(${JSON.stringify(`${dir}/__fixtures__/node-fixtures.ts`)})
      const { AnyNode, nodeKindOf } = await import(${JSON.stringify(`${dir}/types.ts`)})

      parsers.enableCompiledNodeParsers()

      const optionByKind = new Map(AnyNode.options.map((o) => [nodeKindOf(o), o]))
      const fixtures = fx.nodeFixtures()
      const compiledAnyway = []
      const parseFailures = []

      for (const kind of fx.NODE_KINDS) {
        const option = optionByKind.get(kind)
        if (parsers.nodeSchemaForKind(kind) !== option) compiledAnyway.push(kind)

        const authored = fx.authoredNodeSchemas().get(kind)
        if (parsers.compiledNodeSchema(authored) !== authored) compiledAnyway.push(kind + ' (authored)')

        if (!parsers.nodeSchemaForKind(kind).safeParse(fixtures.get(kind)).success) {
          parseFailures.push(kind)
        }
      }

      console.log(JSON.stringify({
        allowsEval: z.core.util.allowsEval.value,
        enabled: parsers.compiledNodeParsersEnabled(),
        kinds: fx.NODE_KINDS.length,
        compiledAnyway,
        parseFailures,
      }))
    `

    const proc = Bun.spawnSync(['bun', '-e', source], { cwd: dir })
    const stdout = proc.stdout.toString().trim()
    expect(proc.exitCode, proc.stderr.toString()).toBe(0)

    const result = JSON.parse(stdout.slice(stdout.lastIndexOf('{')))
    expect(result.allowsEval).toBe(false)
    expect(result.enabled).toBe(true)
    expect(result.kinds).toBe(NODE_KINDS.length)
    expect(result.compiledAnyway).toEqual([])
    expect(result.parseFailures).toEqual([])
  }, 60_000)
})

describe('zod compile contract', () => {
  // The whole design rests on `z.compile` never throwing and never mutating its
  // input. Pin both so a zod bump that changes either fails here, not in prod.
  test('declines unsupported schemas without throwing', () => {
    const cyclic: z.ZodType = z.lazy(() => z.object({ next: cyclic.optional() }))
    expect(z.compile(cyclic)).toBe(cyclic)
    expect(() => z.compile(cyclic, { strict: true })).toThrow()
  })
})
