import { describe, expect, it } from 'bun:test'
import type { AnyNode, ItemNode, SlabNode, Space } from '@pascal-app/core'
import {
  availablePaintScopes,
  cyclePaintScope,
  type PaintHoverInfo,
  type PaintScope,
  paintScopeLabel,
  resolvePaintScopeTargets,
} from './paint-scope'

describe('availablePaintScopes', () => {
  it('every node offers single', () => {
    expect(availablePaintScopes({ node: roof(), slotRoles: ['top'] })).toEqual(['single'])
  })
  it('more than one slot adds whole-object', () => {
    expect(availablePaintScopes({ node: roof(), slotRoles: ['top', 'edge'] })).toEqual([
      'single',
      'object',
    ])
  })
  it('a single slot does not add whole-object', () => {
    expect(availablePaintScopes({ node: roof(), slotRoles: ['top'] })).not.toContain('object')
  })
  it('an asset adds all-matching (items)', () => {
    expect(availablePaintScopes({ node: item('a', 'sofa'), slotRoles: ['seat'] })).toContain(
      'matching',
    )
  })
  // `room` derives from the kind's registry `capabilities.paint.roomScope`, which
  // isn't wired in this unit context; its resolver behaviour is covered below.
})

describe('cyclePaintScope', () => {
  it('wraps within the given set', () => {
    const set: PaintScope[] = ['single', 'object', 'matching']
    expect(cyclePaintScope('single', set)).toBe('object')
    expect(cyclePaintScope('object', set)).toBe('matching')
    expect(cyclePaintScope('matching', set)).toBe('single')
  })
  it('a scope foreign to the set restarts at the first entry', () => {
    expect(cyclePaintScope('matching', ['single', 'room'])).toBe('single')
  })
  it('an empty set stays single', () => {
    expect(cyclePaintScope('single', [])).toBe('single')
  })
})

describe('paintScopeLabel', () => {
  const info = (over: Partial<PaintHoverInfo>): PaintHoverInfo => ({
    scopes: ['single'],
    slotLabel: 'Seat cushion',
    nodeNoun: 'item',
    ...over,
  })
  it('single shows the hovered slot label', () => {
    expect(paintScopeLabel('single', info({ slotLabel: 'Seat cushion' }))).toBe('Seat cushion')
  })
  it('single falls back when there is no slot label', () => {
    expect(paintScopeLabel('single', info({ slotLabel: '' }))).toBe('This surface')
  })
  it('object reads "Whole <noun>"', () => {
    expect(paintScopeLabel('object', info({ nodeNoun: 'shelf' }))).toBe('Whole shelf')
  })
  it('matching / room are kind-agnostic', () => {
    expect(paintScopeLabel('matching', info({}))).toBe('All matching')
    expect(paintScopeLabel('room', info({}))).toBe('Room')
  })
})

// ── resolvePaintScopeTargets ────────────────────────────────────────────────

function item(id: string, assetId: string): ItemNode {
  return { id, type: 'item', asset: { id: assetId } } as unknown as ItemNode
}
function slab(id: string, polygon: Array<[number, number]>): SlabNode {
  return { id, type: 'slab', polygon } as unknown as SlabNode
}
function wall(id: string, start: [number, number], end: [number, number]): AnyNode {
  return { id, type: 'wall', start, end } as unknown as AnyNode
}
function roof(): AnyNode {
  return { id: 'r', type: 'roof' } as unknown as AnyNode
}
function asMap(nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}
const noSlotRoles = () => [] as string[]

// `nodeId` is a branded id type; compare by plain `id:role` strings.
function keys(targets: Array<{ nodeId: string; role: string }>): string[] {
  return targets.map((target) => `${target.nodeId}:${target.role}`)
}

function resolve(args: {
  node: AnyNode
  role?: string
  scope: PaintScope
  nodes: AnyNode[]
  spaces?: Space[]
  slotRolesOf?: (node: AnyNode) => string[]
}) {
  return resolvePaintScopeTargets({
    node: args.node,
    role: args.role ?? 'surface',
    scope: args.scope,
    nodes: asMap(args.nodes),
    spaces: Object.fromEntries((args.spaces ?? []).map((s) => [s.id, s])),
    slotRolesOf: args.slotRolesOf ?? noSlotRoles,
  })
}

describe('resolvePaintScopeTargets', () => {
  it('single always returns just the clicked surface', () => {
    const a = item('a', 'sofa')
    expect(
      keys(resolve({ node: a, role: 'seat', scope: 'single', nodes: [a, item('b', 'sofa')] })),
    ).toEqual(['a:seat'])
  })

  it('item matching fans the same slot across same-asset items only', () => {
    const a = item('a', 'sofa')
    const b = item('b', 'sofa')
    const c = item('c', 'lamp')
    const result = resolve({ node: a, role: 'seat', scope: 'matching', nodes: [a, b, c] })
    expect(keys(result).sort()).toEqual(['a:seat', 'b:seat'])
  })

  it('item whole-item fans every enumerated slot of the clicked item', () => {
    const a = item('a', 'sofa')
    const result = resolve({
      node: a,
      role: 'seat',
      scope: 'object',
      nodes: [a],
      slotRolesOf: () => ['seat', 'legs', 'cushion'],
    })
    expect(keys(result)).toEqual(['a:seat', 'a:legs', 'a:cushion'])
  })

  it('item whole-item falls back to the single slot when the subtree is unmounted', () => {
    const a = item('a', 'sofa')
    expect(keys(resolve({ node: a, role: 'seat', scope: 'object', nodes: [a] }))).toEqual([
      'a:seat',
    ])
  })

  it('wall room fans the same side across the walls bounding the room polygon', () => {
    // A 4×4 room: each wall's endpoints are exact polygon vertices.
    const w1 = wall('w1', [0, 0], [4, 0])
    const w2 = wall('w2', [4, 0], [4, 4])
    const w3 = wall('w3', [4, 4], [0, 4])
    const w4 = wall('w4', [0, 4], [0, 0])
    const wOut = wall('wOut', [10, 10], [14, 10]) // not on the room boundary
    const space: Space = {
      id: 's1',
      levelId: 'l1',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      wallIds: [], // always empty in practice — membership is geometric
      isExterior: false,
    }
    const result = resolve({
      node: w1,
      role: 'interior',
      scope: 'room',
      nodes: [w1, w2, w3, w4, wOut],
      spaces: [space],
    })
    expect(keys(result).sort()).toEqual([
      'w1:interior',
      'w2:interior',
      'w3:interior',
      'w4:interior',
    ])
  })

  it('wall room with no enclosing space falls back to single', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    expect(
      keys(resolve({ node: w1, role: 'interior', scope: 'room', nodes: [w1], spaces: [] })),
    ).toEqual(['w1:interior'])
  })

  it('slab room fans across slabs whose centroid sits in the same space', () => {
    const inside = slab('inA', [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ])
    const alsoInside = slab('inB', [
      [2, 2],
      [2.5, 2],
      [2.5, 2.5],
      [2, 2.5],
    ])
    const outside = slab('out', [
      [20, 20],
      [21, 20],
      [21, 21],
      [20, 21],
    ])
    const space: Space = {
      id: 's1',
      levelId: 'l1',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      wallIds: [],
      isExterior: false,
    }
    const result = resolve({
      node: inside,
      role: 'surface',
      scope: 'room',
      nodes: [inside, alsoInside, outside],
      spaces: [space],
    })
    expect(keys(result).sort()).toEqual(['inA:surface', 'inB:surface'])
  })
})
