import { z } from 'zod'
import * as schema from '../index'
import { AnyNode, type AnyNodeType, nodeKindOf } from '../types'

/**
 * Minimal valid instances of every node kind, built from the kinds' own
 * schemas. Shared by the `AnyNode` contract test, the compiled-parser parity
 * test, and the schema bench so all three cover the same 48 kinds without
 * three copies of the table drifting apart.
 */

/** Fields a kind requires beyond the defaults its own schema fills in. */
export const NODE_REQUIRED_FIELDS: Record<string, Record<string, unknown>> = {
  ceiling: {
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  },
  'duct-segment': {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  fence: { start: [0, 0], end: [4, 0] },
  guide: { url: 'asset://guide.png' },
  item: {
    asset: {
      id: 'asset-1',
      category: 'furniture',
      name: 'Chair',
      thumbnail: 'asset://chair.png',
      src: 'asset://chair.glb',
    },
  },
  lineset: {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  'liquid-line': {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  measurement: {
    measurement: {
      kind: 'distance',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    },
  },
  'pipe-segment': {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  slab: {
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  },
  wall: { start: [0, 0], end: [4, 0] },
  zone: {
    name: 'Kitchen',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  },
}

/** Every kind `AnyNode` discriminates on. */
export const NODE_KINDS: AnyNodeType[] = AnyNode.options.map(nodeKindOf)

/** A node schema as authored — discriminator still wrapped by `nodeType()`. */
export type AuthoredNodeSchema = z.ZodObject<
  { type: z.ZodDefault<z.ZodLiteral<string>> } & z.core.$ZodLooseShape
>

export function isAuthoredNodeSchema(value: unknown): value is AuthoredNodeSchema {
  if (!(value instanceof z.ZodObject)) return false
  const discriminator = (value.shape as Record<string, unknown>).type
  return discriminator instanceof z.ZodDefault && discriminator.unwrap() instanceof z.ZodLiteral
}

let authored: Map<string, AuthoredNodeSchema> | undefined

/** kind → the per-kind schema the package exports, keyed off its own default. */
export function authoredNodeSchemas(): Map<string, AuthoredNodeSchema> {
  if (authored) return authored

  authored = new Map()
  for (const exported of Object.values(schema)) {
    if (!isAuthoredNodeSchema(exported)) continue
    authored.set(exported.shape.type.unwrap().value, exported)
  }
  return authored
}

let fixtures: Map<AnyNodeType, Record<string, unknown>> | undefined

/**
 * kind → a minimal valid node with every schema default materialized.
 *
 * Always parsed through the raw authored schema, which `z.compile` leaves
 * untouched (it returns a clone), so the fixtures are an interpreted baseline
 * regardless of whether compiled parsers are enabled.
 */
export function nodeFixtures(): Map<AnyNodeType, Record<string, unknown>> {
  if (fixtures) return fixtures

  const schemas = authoredNodeSchemas()
  fixtures = new Map()
  for (const kind of NODE_KINDS) {
    const perKind = schemas.get(kind)
    if (!perKind) throw new Error(`no per-kind schema exported for "${kind}"`)

    const parsed = perKind.safeParse({ ...NODE_REQUIRED_FIELDS[kind] })
    if (!parsed.success) {
      throw new Error(
        `fixture for "${kind}" does not satisfy its own schema: ${parsed.error.message}`,
      )
    }
    fixtures.set(kind, parsed.data as Record<string, unknown>)
  }
  return fixtures
}
