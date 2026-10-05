import { describe, expect, it } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  detectSpacesForLevel,
  type ItemNode,
  nodeRegistry,
  registerNode,
  type SlabNode,
  type Space,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { z } from 'zod'
import {
  availablePaintScopes,
  commitPaintScopeFanout,
  cyclePaintScope,
  effectivePaintScope,
  type PaintHoverInfo,
  type PaintScope,
  paintHoverInfo,
  paintScopeLabel,
  paintScopeRole,
  paintSurfaceLabel,
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
function slab(id: string, polygon: Array<[number, number]>, levelId = 'l1'): SlabNode {
  return { id, type: 'slab', polygon, parentId: levelId } as unknown as SlabNode
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
      role: 'a',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'front', point: [3.9, 2] },
    })
    // Without zones the detected space drives the spread; each wall paints the
    // physical face it turns to the room.
    expect(keys(leftRoom).sort()).toEqual(['bottom-left:a', 'left:a', 'shared:a', 'top-left:a'])

    const rightRoom = resolve({
      node: shared,
      role: 'b',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })
    expect(keys(rightRoom).sort()).toEqual(['bottom-right:a', 'right:a', 'shared:b', 'top-right:a'])
  })

  it('wall room keeps the trim while mapping each boundary face side', () => {
    const { walls, spaces } = adjacentRooms()
    const shared = walls.find((candidate) => String(candidate.id) === 'shared')!
    const result = resolve({
      node: shared,
      role: 'bSkirting',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })
    expect(keys(result).sort()).toEqual([
      'bottom-right:aSkirting',
      'right:aSkirting',
      'shared:bSkirting',
      'top-right:aSkirting',
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
      role: 'b',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })

    // Reversed, top-right turns its b face to the right room.
    expect(keys(result)).toContain('top-right:b')
    expect(keys(result)).not.toContain('top-right:a')
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
      role: 'a',
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
      role: 'b',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [2, -0.1] },
    })
    const rightBay = resolve({
      node: long,
      role: 'b',
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
    expect(keys(resolve({ node: w1, role: 'a', scope: 'room', nodes: [w1], spaces: [] }))).toEqual([
      'w1:a',
    ])
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
          role: 'b',
          scope: 'room',
          nodes: walls,
          spaces,
          wallHit: { face: 'back', point: [2, -0.1] },
        }),
      ).sort(),
    ).toEqual(['bottom:b', 'left:b', 'right:b', 'top:b'])
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
      role: 'b',
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
      role: 'b',
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
      role: 'b',
      scope: 'room',
      nodes: walls,
      spaces,
      wallHit: { face: 'back', point: [2, -0.1] },
    })

    expect(keys(result).filter((key) => key === 'long:b')).toHaveLength(1)
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

  it('slab room stops at the level boundary', () => {
    // Stacked storeys share a footprint, so the upper slab's centroid sits inside
    // the ground floor's space polygon. Painting downstairs must not reach it.
    const ground = slab(
      'ground',
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      'l1',
    )
    const upstairs = slab(
      'upstairs',
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      'l2',
    )
    const footprint: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const result = resolve({
      node: ground,
      role: 'surface',
      scope: 'room',
      nodes: [ground, upstairs],
      spaces: [
        {
          id: 's1',
          levelId: 'l1',
          polygon: footprint,
          wallIds: [],
          boundaryFaces: [],
          isExterior: false,
        },
        {
          id: 's2',
          levelId: 'l2',
          polygon: footprint,
          wallIds: [],
          boundaryFaces: [],
          isExterior: false,
        },
      ],
    })
    expect(keys(result)).toEqual(['ground:surface'])
  })
})

describe('wall room scope inside a zone', () => {
  function zonedRooms() {
    const { walls, spaces } = adjacentRooms()
    const level = { id: 'l1', type: 'level', children: [] as string[] } as unknown as AnyNode
    // The fixture walls carry plain ids, so the zones skip schema parsing.
    const zone = (id: string, polygon: Array<[number, number]>, boundary: string[]) =>
      ({
        id,
        type: 'zone',
        name: id,
        parentId: 'l1',
        polygon,
        holes: [],
        boundaryWallIds: boundary,
      }) as unknown as ZoneNode
    const zones = [
      zone(
        'zone_left',
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        ['bottom-left', 'shared', 'top-left', 'left'],
      ),
      zone(
        'zone_right',
        [
          [4, 0],
          [8, 0],
          [8, 4],
          [4, 4],
        ],
        ['bottom-right', 'right', 'top-right', 'shared'],
      ),
    ]
    ;(level as unknown as { children: string[] }).children = [
      ...walls.map((w) => String(w.id)),
      ...zones.map((z) => z.id),
    ]
    const shared = walls.find((candidate) => String(candidate.id) === 'shared')!
    return { nodes: [level, ...walls, ...zones] as AnyNode[], spaces, shared }
  }

  it('paints the room the hit face borders, as one room commit listed on its walls', () => {
    const { nodes, spaces, shared } = zonedRooms()
    const left = resolve({
      node: shared,
      role: 'a',
      scope: 'room',
      nodes,
      spaces,
      wallHit: { face: 'front', point: [3.9, 2] },
    })
    expect(keys(left).sort()).toEqual([
      'bottom-left:room:zone_left',
      'left:room:zone_left',
      'shared:room:zone_left',
      'top-left:room:zone_left',
    ])
    // A hit on a face already showing its room finish names the room directly.
    const right = resolve({
      node: shared,
      role: 'room:zone_right/b',
      scope: 'room',
      nodes,
      spaces,
      wallHit: { face: 'front', point: [4.1, 2] },
    })
    expect(new Set(right.map((target) => target.role))).toEqual(new Set(['room:zone_right']))
    expect(right).toHaveLength(4)
  })

  it('fans a trim to the face each wall turns to the room, and keeps regions single', () => {
    const { nodes, spaces, shared } = zonedRooms()
    const trims = resolve({
      node: shared,
      role: 'bSkirting',
      scope: 'room',
      nodes,
      spaces,
      wallHit: { face: 'back', point: [4.1, 2] },
    })
    expect(keys(trims).sort()).toEqual([
      'bottom-right:aSkirting',
      'right:aSkirting',
      'shared:bSkirting',
      'top-right:aSkirting',
    ])
    expect(
      keys(
        resolve({
          node: shared,
          role: 'region:wainscot',
          scope: 'room',
          nodes,
          spaces,
          wallHit: { face: 'front', point: [3.9, 2] },
        }),
      ),
    ).toEqual([
      'shared:room:zone_left',
      'bottom-left:room:zone_left',
      'top-left:room:zone_left',
      'left:room:zone_left',
    ])
  })
})

describe('wall and floor scopes', () => {
  it('a wall offers its face or its room, never the whole wall', () => {
    const wall = { id: 'wall_x', type: 'wall', parentId: 'level_x' } as unknown as AnyNode
    expect(availablePaintScopes({ node: wall, slotRoles: ['a', 'b', 'aSkirting'] })).toEqual([
      'single',
      'room',
    ])
    expect(paintScopeLabel('single', { scopes: [], slotLabel: 'Face', nodeNoun: 'wall' })).toBe(
      'Face',
    )
    expect(paintSurfaceLabel(wall, 'room:zone_left/a')).toBe('Face')
    expect(paintSurfaceLabel(wall, 'region:wainscot')).toBe('Face')
    expect(paintSurfaceLabel(wall, 'a')).toBe('Face')
  })

  it('the room scope on a room floor is one room-wide role on every plate of the level', () => {
    const plate = (id: string) =>
      ({
        id,
        type: 'slab',
        parentId: 'level_f',
        boundary: 'auto',
        zoneIds: [],
      }) as unknown as AnyNode
    const nodes = { plate_a: plate('plate_a'), plate_b: plate('plate_b') } as Record<
      string,
      AnyNode
    >
    const targets = resolvePaintScopeTargets({
      node: nodes.plate_a!,
      role: 'room:zone_k/rug',
      scope: 'room',
      nodes,
      spaces: {},
      slotRolesOf: () => [],
    })
    expect(targets.map((target) => `${target.nodeId}:${target.role}`)).toEqual([
      'plate_a:room:zone_k/*',
      'plate_b:room:zone_k/*',
    ])
  })
})

describe('commitPaintScopeFanout routing', () => {
  it('commits a routed role once through its kind and writes slot roles as slots', () => {
    const kind = 'paint-route-test'
    const commits: string[] = []
    if (!nodeRegistry.has(kind))
      registerNode({
        kind,
        schemaVersion: 1,
        schema: z.object({ type: z.literal(kind) }) as never,
        category: 'structure',
        defaults: () => ({}),
        capabilities: {
          slots: () => [{ slotId: 'a', label: 'A', default: 'library:x' }],
          paint: {
            resolveRole: () => null,
            buildPatch: () => ({}),
            applyPreview: () => null,
            commit: ({ role }: { role: string }) => {
              commits.push(role)
            },
          },
        },
        floorplanScope: 'level',
        renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
      } as unknown as AnyNodeDefinition)
    const node = (id: string) => ({ id, type: kind, slots: {} }) as unknown as AnyNode
    useScene.setState({
      nodes: {
        n1: node('n1'),
        n2: node('n2'),
        zone_x: { id: 'zone_x', type: 'zone' } as unknown as AnyNode,
      },
      materials: {},
      dirtyNodes: new Set(),
    } as never)
    const at = (id: string, role: string) => ({ nodeId: id as AnyNodeId, role })
    commitPaintScopeFanout(
      [at('n1', 'room:zone_x'), at('n2', 'room:zone_x'), at('zone_x', 'room:zone_x')],
      undefined,
      'library:red',
    )
    expect(commits).toEqual(['room:zone_x'])
    expect(
      (useScene.getState().nodes.zone_x as unknown as { slots?: unknown }).slots,
    ).toBeUndefined()
    commitPaintScopeFanout([at('n1', 'a'), at('n2', 'a')], undefined, 'library:red')
    const slots = (id: string) =>
      (useScene.getState().nodes[id as AnyNodeId] as never as { slots: object }).slots
    expect(slots('n1')).toEqual({ a: 'library:red' })
    expect(slots('n2')).toEqual({ a: 'library:red' })
    expect(commits).toEqual(['room:zone_x'])
  })
})

describe('generated floor plates: scopes per surface', () => {
  const plate = (plateRole: 'base' | 'platform' = 'base') =>
    ({
      id: `plate_${plateRole}`,
      type: 'slab',
      parentId: 'level_p',
      boundary: 'auto',
      plateRole,
      zoneIds: [],
    }) as unknown as AnyNode
  const manual = { id: 'slab_hand', type: 'slab', parentId: 'level_p' } as unknown as AnyNode
  const chip = (node: AnyNode, role: string) => {
    const info = paintHoverInfo(node, role, ['foundation', 'surface', 'side', 'edge'])
    return info.scopes.map((scope) => paintScopeLabel(scope, info))
  }

  it('a floor is this surface or the whole room', () => {
    expect(chip(plate(), 'room:zone_k')).toEqual(['This surface', 'Whole room'])
    expect(chip(plate(), 'room:zone_k/rug')).toEqual(['This surface', 'Whole room'])
    expect(chip(plate('platform'), 'room:zone_k')).toEqual(['This surface', 'Whole room'])
  })

  it('a step is this step or every step of its room', () => {
    expect(chip(plate(), 'step:zone_k/door_1')).toEqual(['This step', 'All steps in this room'])
  })

  it("a footprint's faces have one fixed label and nothing to cycle", () => {
    expect(chip(plate(), 'edge')).toEqual(['Floor edge · all around this floor'])
    expect(chip(plate(), 'foundation')).toEqual(['Foundation · all around this floor'])
    expect(chip(plate(), 'riser')).toEqual(['Riser · all around this floor'])
    expect(chip(plate(), 'underside')).toEqual(['Underside · all of this floor'])
  })

  it('no plate offers the whole slab; a hand-drawn slab still does', () => {
    for (const role of ['room:zone_k', 'step:zone_k/door_1', 'edge', 'foundation', 'riser'])
      expect(paintHoverInfo(plate(), role, ['foundation', 'surface', 'side']).scopes).not.toContain(
        'object',
      )
    // (The room scope comes from the registry, not wired in this unit context.)
    expect(chip(manual, 'surface')).toContain('Whole slab')
  })

  it('a scope the surface does not offer paints just that surface', () => {
    const node = plate()
    const nodes = { [node.id]: node } as Record<string, AnyNode>
    const targets = (role: string, scope: PaintScope) =>
      resolvePaintScopeTargets({
        node,
        role,
        scope,
        nodes,
        spaces: {},
        slotRolesOf: () => ['foundation', 'surface', 'side', 'edge', 'riser', 'underside'],
      }).map((target) => `${target.nodeId}:${target.role}`)
    expect(targets('room:zone_k', 'object')).toEqual(['plate_base:room:zone_k'])
    expect(targets('edge', 'object')).toEqual(['plate_base:edge'])
    expect(targets('edge', 'room')).toEqual(['plate_base:edge'])
    expect(targets('foundation', 'room')).toEqual(['plate_base:foundation'])
    expect(effectivePaintScope('object', ['single', 'room'])).toBe('single')
    expect(effectivePaintScope('room', ['single', 'room'])).toBe('room')
  })

  it('the whole room is one room-wide role; its steps are one room step role', () => {
    expect(paintScopeRole(plate(), 'room:zone_k/rug', 'room')).toBe('room:zone_k/*')
    expect(paintScopeRole(plate(), 'room:zone_k', 'single')).toBe('room:zone_k')
    expect(paintScopeRole(plate(), 'step:zone_k/door_1', 'room')).toBe('step:zone_k')
    expect(paintScopeRole(manual, 'surface', 'room')).toBe('surface')
  })
})
