import { describe, expect, it } from 'bun:test'
import {
  type AnyNode,
  detectSpacesForLevel,
  type ItemNode,
  type SlabNode,
  type Space,
  type WallNode,
} from '@pascal-app/core'
import {
  availablePaintScopes,
  cyclePaintScope,
  type PaintHoverInfo,
  type PaintScope,
  paintScopeLabel,
  resolvePaintScopeTargets,
  type WallPaintHit,
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
function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  levelId = 'l1',
): WallNode {
  return {
    id,
    type: 'wall',
    parentId: levelId,
    start,
    end,
    thickness: 0.2,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as WallNode
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
  wallHit?: WallPaintHit
}) {
  return resolvePaintScopeTargets({
    node: args.node,
    role: args.role ?? 'surface',
    scope: args.scope,
    nodes: asMap(args.nodes),
    spaces: Object.fromEntries((args.spaces ?? []).map((s) => [s.id, s])),
    slotRolesOf: args.slotRolesOf ?? noSlotRoles,
    wallHit: args.wallHit,
  })
}

function adjacentRooms(levelId = 'l1') {
  const walls = [
    wall('bottom-left', [0, 0], [4, 0], levelId),
    wall('bottom-right', [4, 0], [8, 0], levelId),
    wall('right', [8, 0], [8, 4], levelId),
    wall('top-right', [8, 4], [4, 4], levelId),
    wall('top-left', [4, 4], [0, 4], levelId),
    wall('left', [0, 4], [0, 0], levelId),
    wall('shared', [4, 0], [4, 4], levelId),
  ]
  return { walls, spaces: detectSpacesForLevel(levelId, walls).spaces }
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

  it('wall room selects the enclosed space on the clicked face of a shared wall', () => {
    const { walls, spaces } = adjacentRooms()
    const shared = walls.find((candidate) => String(candidate.id) === 'shared')!

    const leftRoom = resolve({
      node: shared,
      role: 'interior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'front', point: [3.9, 2] },
    })
    expect(keys(leftRoom).sort()).toEqual([
      'bottom-left:interior',
      'left:interior',
      'shared:interior',
      'top-left:interior',
    ])

    const rightRoom = resolve({
      node: shared,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })
    expect(keys(rightRoom).sort()).toEqual([
      'bottom-right:interior',
      'right:interior',
      'shared:exterior',
      'top-right:interior',
    ])
  })

  it('wall room preserves the vertical band while mapping each boundary face side', () => {
    const { walls, spaces } = adjacentRooms()
    const shared = walls.find((candidate) => String(candidate.id) === 'shared')!
    const result = resolve({
      node: shared,
      role: 'lowerExterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })
    expect(keys(result).sort()).toEqual([
      'bottom-right:lowerInterior',
      'right:lowerInterior',
      'shared:lowerExterior',
      'top-right:lowerInterior',
    ])
  })

  it('wall room maps a reversed boundary wall to its rendered side', () => {
    const { walls } = adjacentRooms()
    const topRight = walls.find((candidate) => String(candidate.id) === 'top-right')!
    topRight.start = [4, 4]
    topRight.end = [8, 4]
    const spaces = detectSpacesForLevel('l1', walls).spaces
    const shared = walls.find((candidate) => String(candidate.id) === 'shared')!
    const result = resolve({
      node: shared,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })

    expect(keys(result)).toContain('top-right:exterior')
    expect(keys(result)).not.toContain('top-right:interior')
  })

  it('wall room excludes duplicate geometry and spaces from another level', () => {
    const levelA = adjacentRooms('l1')
    const levelB = adjacentRooms('l2')
    const levelBWalls = levelB.walls.map((candidate) => ({
      ...candidate,
      id: `other-${candidate.id}`,
    })) as unknown as WallNode[]
    const otherSpaces = detectSpacesForLevel('l2', levelBWalls).spaces
    const shared = levelA.walls.find((candidate) => String(candidate.id) === 'shared')!
    const result = resolve({
      node: shared,
      role: 'interior',
      scope: 'room',
      nodes: [...levelA.walls, ...levelBWalls],
      spaces: [...levelA.spaces, ...otherSpaces],
      wallHit: { face: 'front', point: [3.9, 2] },
    })
    expect(keys(result).every((key) => !key.startsWith('other-'))).toBe(true)
    expect(result).toHaveLength(4)
  })

  it('wall room uses the hit subsegment when one long wall bounds adjacent bays', () => {
    const long = wall('long', [0, 0], [8, 0])
    const walls = [
      long,
      wall('left', [0, 0], [0, -3]),
      wall('left-bottom', [0, -3], [4, -3]),
      wall('divider', [4, -3], [4, 0]),
      wall('right-bottom', [4, -3], [8, -3]),
      wall('right', [8, -3], [8, 0]),
    ]
    const spaces = detectSpacesForLevel('l1', walls).spaces

    const leftBay = resolve({
      node: long,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [2, -0.1] },
    })
    const rightBay = resolve({
      node: long,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [6, -0.1] },
    })

    expect(keys(leftBay).some((key) => key.startsWith('left-bottom:'))).toBe(true)
    expect(keys(leftBay).some((key) => key.startsWith('right-bottom:'))).toBe(false)
    expect(keys(rightBay).some((key) => key.startsWith('right-bottom:'))).toBe(true)
    expect(keys(rightBay).some((key) => key.startsWith('left-bottom:'))).toBe(false)
  })

  it('wall room with no enclosing space falls back to single', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    expect(
      keys(resolve({ node: w1, role: 'interior', scope: 'room', nodes: [w1], spaces: [] })),
    ).toEqual(['w1:interior'])
  })

  it('wall room paints the connected exterior envelope from an exterior face', () => {
    const walls = [
      wall('bottom', [0, 0], [4, 0]),
      wall('right', [4, 0], [4, 4]),
      wall('top', [4, 4], [0, 4]),
      wall('left', [0, 4], [0, 0]),
    ]
    const spaces = detectSpacesForLevel('l1', walls).spaces
    expect(
      keys(
        resolve({
          node: walls[0]!,
          role: 'exterior',
          scope: 'room',
          nodes: walls,
          spaces,
          wallHit: { face: 'back', point: [2, -0.1] },
        }),
      ).sort(),
    ).toEqual(['bottom:exterior', 'left:exterior', 'right:exterior', 'top:exterior'])
  })

  it('wall room does not cross to a disconnected exterior envelope', () => {
    const first = [
      wall('a-bottom', [0, 0], [4, 0]),
      wall('a-right', [4, 0], [4, 4]),
      wall('a-top', [4, 4], [0, 4]),
      wall('a-left', [0, 4], [0, 0]),
    ]
    const second = [
      wall('b-bottom', [10, 0], [14, 0]),
      wall('b-right', [14, 0], [14, 4]),
      wall('b-top', [14, 4], [10, 4]),
      wall('b-left', [10, 4], [10, 0]),
    ]
    const walls = [...first, ...second]
    const spaces = detectSpacesForLevel('l1', walls).spaces
    const result = resolve({
      node: first[0]!,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [2, -0.1] },
    })

    expect(result).toHaveLength(4)
    expect(keys(result).every((key) => key.startsWith('a-'))).toBe(true)
  })

  it('wall room excludes shared interior walls from the exterior envelope', () => {
    const { walls, spaces } = adjacentRooms()
    const bottomLeft = walls.find((candidate) => String(candidate.id) === 'bottom-left')!
    const result = resolve({
      node: bottomLeft,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [2, -0.1] },
    })

    expect(result).toHaveLength(6)
    expect(keys(result).some((key) => key.startsWith('shared:'))).toBe(false)
  })

  it('wall room follows an exterior wall that is logically split across rooms', () => {
    const long = wall('long', [0, 0], [8, 0])
    const walls = [
      long,
      wall('right', [8, 0], [8, 4]),
      wall('top-right', [8, 4], [4, 4]),
      wall('top-left', [4, 4], [0, 4]),
      wall('left', [0, 4], [0, 0]),
      wall('divider', [4, 0], [4, 4]),
    ]
    const spaces = detectSpacesForLevel('l1', walls).spaces
    const result = resolve({
      node: long,
      role: 'exterior',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [2, -0.1] },
    })

    expect(keys(result).filter((key) => key === 'long:exterior')).toHaveLength(1)
    expect(keys(result).some((key) => key.startsWith('divider:'))).toBe(false)
    expect(result).toHaveLength(5)
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
      boundaryFaces: [],
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
