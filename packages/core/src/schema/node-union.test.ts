import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { authoredNodeSchemas, NODE_KINDS, NODE_REQUIRED_FIELDS } from './__fixtures__/node-fixtures'
import { nodeType } from './base'
import { AnyNode, type AnyNodeOption, nodeKindOf, nodeUnion } from './types'

/**
 * `nodeType()` wraps every node's discriminator in `.default()`. Zod 4.5 made a
 * wrapped discriminator additionally claim `undefined`, which collides across
 * members and throws `Duplicate discriminator value "undefined"` out of
 * `safeParse` at the union's first parse. `nodeUnion()` projects each member's
 * discriminator down to its bare literal to keep that unrepresentable; these
 * tests fail in CI if the projection regresses or a zod upgrade breaks it.
 */

const authoredByKind = authoredNodeSchemas()

describe('nodeUnion', () => {
  test('assembles a parsable union from nodeType() members', () => {
    const Alpha = z.object({ id: z.string(), type: nodeType('alpha'), size: z.number().default(1) })
    const Beta = z.object({ id: z.string(), type: nodeType('beta') }).describe('a beta node')
    const Union = nodeUnion([Alpha, Beta])

    expect(Union.parse({ id: 'a_1', type: 'alpha' })).toEqual({
      id: 'a_1',
      type: 'alpha',
      size: 1,
    })
    expect(Union.parse({ id: 'b_1', type: 'beta' })).toEqual({ id: 'b_1', type: 'beta' })

    const unknownKind = Union.safeParse({ id: 'c_1', type: 'gamma' })
    expect(unknownKind.success).toBe(false)
    expect(unknownKind.error?.issues[0]?.path).toEqual(['type'])
  })

  test('carries member metadata onto the projected clone', () => {
    const Beta = z.object({ id: z.string(), type: nodeType('beta') }).describe('a beta node')
    const Union = nodeUnion([z.object({ id: z.string(), type: nodeType('alpha') }), Beta])

    expect(Union.options[1].description).toBe('a beta node')
  })

  test('projects the discriminator to a bare literal', () => {
    for (const option of AnyNode.options) {
      expect(option.shape.type).toBeInstanceOf(z.ZodLiteral)
    }
  })

  test('keeps the descriptions the node schemas were authored with', () => {
    const described = AnyNode.options.filter((option) => option.description !== undefined)
    expect(described.length).toBeGreaterThan(40)

    for (const option of AnyNode.options) {
      const authored = authoredByKind.get(nodeKindOf(option))
      expect(authored?.description).toBe(option.description)
    }
  })
})

describe('AnyNode', () => {
  test('rejects a type-less node without throwing', () => {
    const result = AnyNode.safeParse({ id: 'wall_1', start: [0, 0], end: [4, 0] })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_union', path: ['type'] }),
    ])
  })

  test('rejects an unknown kind at the discriminator', () => {
    const result = AnyNode.safeParse({ id: 'x_1', type: 'not-a-node' })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_union', path: ['type'] }),
    ])
  })

  test('reports member issues at the member path', () => {
    const result = AnyNode.safeParse({ id: 'wall_1', type: 'wall', start: 'nope', end: [4, 0] })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'tuple', path: ['start'] }),
    ])
  })

  test('exposes every union kind as a per-kind schema', () => {
    const missing = NODE_KINDS.filter((kind) => !authoredByKind.has(kind))
    expect(missing).toEqual([])
  })

  test('NODE_REQUIRED_FIELDS lists no kind outside the union', () => {
    const stale = Object.keys(NODE_REQUIRED_FIELDS).filter(
      (kind) => !NODE_KINDS.includes(kind as (typeof NODE_KINDS)[number]),
    )
    expect(stale).toEqual([])
  })

  // The projection only changes the union's view of `type`, so the two-step
  // authoring path has to keep working for every kind: parse a type-less
  // fixture through the per-kind schema (its `.default()` fills `type` in),
  // then parse that output through the union.
  test.each(NODE_KINDS)('round-trips a %s through per-kind then union', (kind) => {
    const authored = authoredByKind.get(kind)
    if (!authored) throw new Error(`no per-kind schema exported for "${kind}"`)

    const perKind = authored.safeParse({ ...NODE_REQUIRED_FIELDS[kind] })
    expect(perKind.error?.issues ?? []).toEqual([])
    expect((perKind.data as { type?: string } | undefined)?.type).toBe(kind)

    const viaUnion = AnyNode.safeParse(perKind.data)
    expect(viaUnion.error?.issues ?? []).toEqual([])
    expect(viaUnion.data).toEqual(perKind.data)
  })

  test('nodeKindOf reads the kind off any option', () => {
    const options: AnyNodeOption[] = [...AnyNode.options]
    expect(new Set(options.map(nodeKindOf)).size).toBe(options.length)
    expect(NODE_KINDS).toContain('wall')
  })
})
