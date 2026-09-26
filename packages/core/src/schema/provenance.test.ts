import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { healSceneNodes } from '../utils/heal-scene-graph'
import { NODE_KINDS, nodeFixtures } from './__fixtures__/node-fixtures'
import { BaseNode } from './base'
import {
  PROVENANCE_MAX_ID_LENGTH,
  PROVENANCE_MAX_LINEAGE_IDS,
  PROVENANCE_MAX_NAMESPACE_LENGTH,
  PROVENANCE_MAX_NODE_ID_LENGTH,
  PROVENANCE_MAX_REFS,
  Provenance,
} from './provenance'
import { AnyNode, nodeKindOf } from './types'

const fixtures = nodeFixtures()
const optionByKind = new Map(AnyNode.options.map((option) => [nodeKindOf(option), option]))

/** The /next house's largest node: one louver window folding 18 roof components. */
const LOUVER: Provenance = {
  refs: Array.from({ length: 18 }, (_, i) => ({
    ns: 'al',
    id: `roof-native-1347${String(i).padStart(2, '0')}-${83 + i}`,
    role: 'absorbed' as const,
  })),
}

const refs = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ns: 'al', id: `source-${i}` }))

const issuePaths = (value: unknown) =>
  (Provenance.safeParse(value).error?.issues ?? []).map((issue) => issue.path.join('.'))

describe('typed provenance on every node (D5)', () => {
  test('absent stays absent: no kind gains a key', () => {
    for (const kind of NODE_KINDS) {
      const parsed = optionByKind.get(kind)!.parse(fixtures.get(kind))
      expect(Object.hasOwn(parsed, 'provenance'), kind).toBe(false)
    }
  })

  test('every kind keeps refs, roles and lineage verbatim', () => {
    const provenance: Provenance = {
      refs: [
        { ns: 'al', id: 'structure-ground-exterior-04-lining/segment-1-r1/drywall' },
        { ns: 'ifc:duplex.ifc', id: '2O2Fr$t4X7Zf8NOew3FLOH', role: 'piece' },
        { id: 'retired-id', role: 'alias' },
      ],
      lineage: { op: 'split', fromIds: ['wall_ground-exterior-04'] },
    }
    for (const kind of NODE_KINDS) {
      const parsed = optionByKind.get(kind)!.parse({ ...fixtures.get(kind), provenance })
      expect(parsed.provenance, kind).toEqual(provenance)
    }
    expect(Provenance.parse(LOUVER)).toEqual(LOUVER)
  })

  test('a plugin field named `source` does not collide', () => {
    const PluginNode = BaseNode.extend({ source: z.enum(['articraft-10k', 'generated']) })
    const parsed = PluginNode.parse({ id: 'asset_1', source: 'generated', provenance: LOUVER })
    expect(parsed.source).toBe('generated')
    expect(parsed.provenance).toEqual(LOUVER)
  })
})

describe('provenance caps refuse, never truncate', () => {
  test('each cap accepts its limit and refuses one more', () => {
    expect(issuePaths({ refs: refs(PROVENANCE_MAX_REFS) })).toEqual([])
    expect(issuePaths({ refs: refs(PROVENANCE_MAX_REFS + 1) })).toEqual(['refs'])

    const id = (length: number) => ({ refs: [{ id: 'x'.repeat(length) }] })
    expect(issuePaths(id(PROVENANCE_MAX_ID_LENGTH))).toEqual([])
    expect(issuePaths(id(PROVENANCE_MAX_ID_LENGTH + 1))).toEqual(['refs.0.id'])

    const ns = (length: number) => ({ refs: [{ ns: 'n'.repeat(length), id: 'a' }] })
    expect(issuePaths(ns(PROVENANCE_MAX_NAMESPACE_LENGTH))).toEqual([])
    expect(issuePaths(ns(PROVENANCE_MAX_NAMESPACE_LENGTH + 1))).toEqual(['refs.0.ns'])

    const from = (count: number, length = 8) => ({
      refs: [],
      lineage: { op: 'merge', fromIds: Array.from({ length: count }, () => 'w'.repeat(length)) },
    })
    expect(issuePaths(from(PROVENANCE_MAX_LINEAGE_IDS))).toEqual([])
    expect(issuePaths(from(PROVENANCE_MAX_LINEAGE_IDS + 1))).toEqual(['lineage.fromIds'])
    expect(issuePaths(from(1, PROVENANCE_MAX_NODE_ID_LENGTH))).toEqual([])
    expect(issuePaths(from(1, PROVENANCE_MAX_NODE_ID_LENGTH + 1))).toEqual(['lineage.fromIds.0'])
  })

  test('empty ids, unknown roles and unknown ops are refused', () => {
    expect(issuePaths({ refs: [{ id: '' }] })).toEqual(['refs.0.id'])
    expect(issuePaths({ refs: [{ id: 'a', role: 'owner' }] })).toEqual(['refs.0.role'])
    expect(issuePaths({ refs: [], lineage: { op: 'rename', fromIds: [] } })).toEqual(['lineage.op'])
    expect(issuePaths({ lineage: { op: 'split', fromIds: [] } })).toEqual(['refs'])
  })

  test('an over-cap node fails its schema and is kept verbatim by the shared heal', () => {
    const wall = {
      ...fixtures.get('wall'),
      id: 'wall_over',
      parentId: null,
      provenance: { refs: refs(PROVENANCE_MAX_REFS + 8) },
    }
    const parsed = AnyNode.safeParse(wall)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['provenance.refs'])

    const healed = healSceneNodes({ [wall.id]: wall })
    expect(healed.nodes[wall.id]).toEqual(wall)
  })

  test('a full ASCII value stays under half the 24 KiB F8 field cap', () => {
    const full: Provenance = {
      refs: Array.from({ length: PROVENANCE_MAX_REFS }, (_, i) => ({
        ns: 'n'.repeat(PROVENANCE_MAX_NAMESPACE_LENGTH),
        id: String(i).padStart(PROVENANCE_MAX_ID_LENGTH, 'x'),
        role: 'absorbed' as const,
      })),
      lineage: {
        op: 'make-independent',
        fromIds: Array.from({ length: PROVENANCE_MAX_LINEAGE_IDS }, (_, i) =>
          String(i).padStart(PROVENANCE_MAX_NODE_ID_LENGTH, 'w'),
        ),
      },
    }
    expect(Provenance.safeParse(full).success).toBe(true)
    const bytes = new TextEncoder().encode(JSON.stringify(full)).byteLength
    expect(bytes).toBeLessThanOrEqual(12 * 1024)
  })
})
