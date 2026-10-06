import { describe, expect, test } from 'bun:test'
import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import {
  checkOpeningWithinWall,
  clearSceneHistory,
  findOpenWallEnds,
  initSpaceDetectionSync,
  LevelNode,
  planJoinOpenWallEnd,
  planWallEndRejoins,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallTopologyChanges,
} from '../../index'
import { extractRooms } from '../../lib/room-graph'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from '../../lib/terrain-field'
import { type AnyNode, type AnyNodeId, DoorNode, WallNode, ZoneNode } from '../../schema'
import { getWallArcData, getWallCurveFrameAt } from './wall-curve'
import { planWallInsertion, planWallSplitAtPoint } from './wall-topology'

const LEVEL_ID = 'level_topology' as AnyNodeId

function nodeMap(nodes: AnyNode[]) {
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

function terrainSceneNodes() {
  const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  const terrain = encodeTerrainField(
    applyHeightPatch(
      base,
      flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 2.5) as never,
    ),
  )
  return [
    {
      id: 'site_topology',
      type: 'site',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['building_topology'],
      terrain,
    },
    {
      id: 'building_topology',
      type: 'building',
      object: 'node',
      parentId: 'site_topology',
      visible: true,
      metadata: {},
      children: [LEVEL_ID],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    {
      id: LEVEL_ID,
      type: 'level',
      object: 'node',
      parentId: 'building_topology',
      visible: true,
      metadata: {},
      children: [],
      level: 0,
      height: 3,
    },
  ] as unknown as AnyNode[]
}

describe('planWallInsertion', () => {
  test('rejects the whole insertion when adjacent crossings would create a sliver', () => {
    const first = WallNode.parse({
      id: 'wall_first',
      parentId: LEVEL_ID,
      start: [2, -2],
      end: [2, 2],
    })
    const second = WallNode.parse({
      id: 'wall_second',
      parentId: LEVEL_ID,
      start: [2.0055, -2],
      end: [2.0055, 2],
    })

    const result = planWallInsertion(nodeMap([first, second]), {
      levelId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      joinRadius: 0.001,
    })

    expect(result).toEqual({ ok: false, reason: 'segment-too-short' })
  })

  test('returns one atomic plan for host splits and inserted wall segments', () => {
    const horizontal = WallNode.parse({
      id: 'wall_horizontal',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
    })

    const result = planWallInsertion(nodeMap([horizontal]), {
      levelId: LEVEL_ID,
      start: [2, -2],
      end: [2, 2],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.changes.delete).toEqual([horizontal.id])
    expect(result.plan.changes.create).toHaveLength(4)
    expect(result.plan.insertedWalls.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: [2, -2], end: [2, 0] },
      { start: [2, 0], end: [2, 2] },
    ])
  })

  test('a room keeps naming its boundary when a T-join splits one of its walls', () => {
    const host = WallNode.parse({ parentId: LEVEL_ID, start: [0, 0], end: [8, 0] })
    const other = WallNode.parse({ parentId: LEVEL_ID, start: [8, 0], end: [8, 6] })
    const room = ZoneNode.parse({
      parentId: LEVEL_ID,
      name: 'Room',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      autoFromWalls: true,
      boundaryWallIds: [host.id, other.id],
    })
    const result = planWallInsertion(nodeMap([host, other, room]), {
      levelId: LEVEL_ID,
      start: [4, 0],
      end: [4, -3],
      joinRadius: 0.1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const replacementIds = result.plan.changes.create
      .map((op) => op.node.id)
      .filter((id) => !result.plan.insertedWalls.some((wall) => wall.id === id))
    expect(replacementIds).toHaveLength(2)
    const zoneUpdate = result.plan.changes.update.find((op) => op.id === room.id)
    expect(zoneUpdate?.data).toEqual({ boundaryWallIds: [...replacementIds, other.id] })
  })
  test('moves an attached opening to the replacement wall that contains it', () => {
    const door = DoorNode.parse({
      id: 'door_attached',
      parentId: 'wall_host',
      wallId: 'wall_host',
      position: [1, 0, 0],
      width: 0.8,
    })
    const host = WallNode.parse({
      id: 'wall_host',
      parentId: LEVEL_ID,
      children: [door.id],
      start: [0, 0],
      end: [4, 0],
    })

    const result = planWallInsertion(nodeMap([host, door]), {
      levelId: LEVEL_ID,
      start: [3, -2],
      end: [3, 2],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.changes.update).toHaveLength(1)
    const update = result.plan.changes.update[0]!
    const replacement = result.plan.changes.create.find(
      ({ node }) => node.id === update.data.parentId,
    )?.node
    expect(update.id).toBe(door.id)
    expect(update.data.position).toEqual([1, 0, 0])
    expect(replacement?.type === 'wall' ? replacement.children : []).toContain(door.id)
  })

  test('keeps a host intact when an opening straddles the crossing', () => {
    const door = DoorNode.parse({
      id: 'door_straddling',
      parentId: 'wall_blocked',
      wallId: 'wall_blocked',
      position: [2, 0, 0],
      width: 1,
    })
    const host = WallNode.parse({
      id: 'wall_blocked',
      parentId: LEVEL_ID,
      children: [door.id],
      start: [0, 0],
      end: [4, 0],
    })

    const result = planWallInsertion(nodeMap([host, door]), {
      levelId: LEVEL_ID,
      start: [2, -2],
      end: [2, 2],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.changes.delete).not.toContain(host.id)
    expect(result.plan.changes.update).toHaveLength(0)
    expect(result.plan.insertedWalls).toHaveLength(2)
  })

  test('rejects a draft already covered by one or more existing walls', () => {
    const first = WallNode.parse({
      id: 'wall_cover_first',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [2, 0],
    })
    const second = WallNode.parse({
      id: 'wall_cover_second',
      parentId: LEVEL_ID,
      start: [2, 0],
      end: [4, 0],
    })

    const result = planWallInsertion(nodeMap([first, second]), {
      levelId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      joinRadius: 0.05,
    })

    expect(result).toEqual({ ok: false, reason: 'covered-existing-wall' })
  })

  test('splits a curved host at its curved centerline intersection', () => {
    const curved = WallNode.parse({
      id: 'wall_curved',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })

    const result = planWallInsertion(nodeMap([curved]), {
      levelId: LEVEL_ID,
      start: [1, -2],
      end: [1, 2],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.insertedWalls[0]?.end[0]).toBeCloseTo(1, 6)
    expect(result.plan.insertedWalls[0]?.end[1]).toBeCloseTo(-0.791288, 6)
    const replacements = result.plan.changes.create
      .map(({ node }) => node)
      .filter(
        (node): node is ReturnType<typeof WallNode.parse> =>
          node.type === 'wall' && !result.plan.insertedWalls.includes(node),
      )
    expect(replacements).toHaveLength(2)
    const originalArc = getWallArcData(curved)!
    for (const replacement of replacements) {
      const arc = getWallArcData(replacement)!
      expect(arc.center.x).toBeCloseTo(originalArc.center.x, 6)
      expect(arc.center.y).toBeCloseTo(originalArc.center.y, 6)
      expect(arc.radius).toBeCloseTo(originalArc.radius, 6)
    }
  })

  test('projects a nearby draft endpoint onto a host and includes that split atomically', () => {
    const host = WallNode.parse({
      id: 'wall_endpoint_host',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
    })

    const result = planWallInsertion(nodeMap([host]), {
      levelId: LEVEL_ID,
      start: [2, 0.01],
      end: [2, 2],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.resolvedStart).toEqual([2, 0])
    expect(result.plan.changes.delete).toEqual([host.id])
    expect(result.plan.insertedWalls).toHaveLength(1)
    expect(result.plan.insertedWalls[0]?.start).toEqual([2, 0])
  })

  test('joins a crossing to a nearby host endpoint instead of splitting off a sliver', () => {
    const host = WallNode.parse({
      id: 'wall_near_endpoint',
      parentId: LEVEL_ID,
      start: [2, -0.005],
      end: [2, 2],
    })

    const result = planWallInsertion(nodeMap([host]), {
      levelId: LEVEL_ID,
      start: [-2, 0],
      end: [4, 0],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.changes.delete).not.toContain(host.id)
    expect(result.plan.insertedWalls[0]?.end).toEqual(host.start)
    expect(result.plan.insertedWalls[1]?.start).toEqual(host.start)
  })

  test('rebases ground-hosted replacement walls to preserve the original construction plane', () => {
    const host = WallNode.parse({
      id: 'wall_terrain_host',
      parentId: LEVEL_ID,
      supportSlabId: GROUND_SUPPORT_ID,
      start: [-3, 3],
      end: [4, 3],
    })

    const result = planWallInsertion(nodeMap([...terrainSceneNodes(), host]), {
      levelId: LEVEL_ID,
      start: [3, 0],
      end: [3, 6],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const terrainReplacement = result.plan.changes.create
      .map(({ node }) => node)
      .find((node) => node.type === 'wall' && node.start[0] === 3 && node.start[1] === 3)
    expect(terrainReplacement?.type === 'wall' ? terrainReplacement.supportOffset : null).toBe(-2.5)
  })

  test('joins a draft endpoint to a curved host without creating a zero-length segment', () => {
    const host = WallNode.parse({
      id: 'wall_curved_endpoint',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })
    const midpoint = getWallCurveFrameAt(host, 0.5).point
    const start: [number, number] = [midpoint.x, midpoint.y]

    const result = planWallInsertion(nodeMap([host]), {
      levelId: LEVEL_ID,
      start,
      end: [2, -3],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.insertedWalls).toHaveLength(1)
    expect(result.plan.insertedWalls[0]?.start[0]).toBeCloseTo(start[0], 6)
    expect(result.plan.insertedWalls[0]?.start[1]).toBeCloseTo(start[1], 6)
    expect(result.plan.changes.delete).toContain(host.id)
  })

  test('splits the same curved host at both draft endpoints', () => {
    const host = WallNode.parse({
      id: 'wall_curved_two_endpoints',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })
    const first = getWallCurveFrameAt(host, 0.25).point
    const second = getWallCurveFrameAt(host, 0.75).point

    const result = planWallInsertion(nodeMap([host]), {
      levelId: LEVEL_ID,
      start: [first.x, first.y],
      end: [second.x, second.y],
      joinRadius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const replacements = result.plan.changes.create
      .map(({ node }) => node)
      .filter(
        (node): node is ReturnType<typeof WallNode.parse> =>
          node.type === 'wall' && !result.plan.insertedWalls.includes(node),
      )
    expect(replacements).toHaveLength(3)
    expect(result.plan.insertedWalls).toHaveLength(1)
  })

  test('does not copy scene identity or children from wall tool defaults', () => {
    const result = planWallInsertion(
      {},
      {
        levelId: LEVEL_ID,
        start: [0, 0],
        end: [4, 0],
        joinRadius: 0.05,
        wallDefaults: {
          id: 'wall_template',
          parentId: 'level_template',
          children: ['door_template'],
          thickness: 0.3,
        },
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.insertedWalls[0]).toMatchObject({
      parentId: null,
      children: [],
      thickness: 0.3,
    })
    expect(result.plan.insertedWalls[0]?.id).not.toBe('wall_template')
  })

  test('maintains topology invariants across deterministic crossing layouts', () => {
    let seed = 0x554
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }

    for (let scenario = 0; scenario < 64; scenario += 1) {
      const crossingCount = 1 + Math.floor(random() * 7)
      const crossings: number[] = []
      while (crossings.length < crossingCount) {
        const x = 0.2 + random() * 9.6
        if (crossings.every((candidate) => Math.abs(candidate - x) >= 0.05)) {
          crossings.push(x)
        }
      }
      crossings.sort((left, right) => left - right)
      const hosts = crossings.map((x, index) =>
        WallNode.parse({
          id: `wall_random_${scenario}_${index}`,
          parentId: LEVEL_ID,
          start: [x, -1],
          end: [x, 1],
        }),
      )

      const result = planWallInsertion(nodeMap(hosts), {
        levelId: LEVEL_ID,
        start: [0, 0],
        end: [10, 0],
        joinRadius: 0.01,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.plan.insertedWalls).toHaveLength(crossingCount + 1)
      expect(new Set(result.plan.changes.create.map(({ node }) => node.id)).size).toBe(
        result.plan.changes.create.length,
      )
      expect(
        result.plan.insertedWalls.every(
          (wall) => Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) >= 0.01,
        ),
      ).toBe(true)
    }
  })
})

describe('planWallSplitAtPoint', () => {
  test('plans an endpoint host split without mutating the input scene', () => {
    const host = WallNode.parse({
      id: 'wall_move_host',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = nodeMap([host])

    const result = planWallSplitAtPoint(nodes, {
      levelId: LEVEL_ID,
      point: [2, 0.01],
      radius: 0.05,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.point).toEqual([2, 0])
    expect(result.plan.changes.delete).toEqual([host.id])
    expect(result.plan.changes.create).toHaveLength(2)
    expect(nodes[host.id]).toBe(host)
  })
})

describe('planJoinOpenWallEnd', () => {
  const apply = (nodes: Record<AnyNodeId, AnyNode>, changes: WallTopologyChanges) => {
    const after = { ...nodes }
    for (const id of changes.delete) delete after[id]
    for (const { node, parentId } of changes.create)
      after[node.id] = { ...node, parentId: parentId ?? node.parentId } as AnyNode
    for (const { id, data } of changes.update) after[id] = { ...after[id], ...data } as AnyNode
    return after
  }
  const wall = (id: string, start: [number, number], end: [number, number]) =>
    WallNode.parse({ id, parentId: LEVEL_ID, start, end })
  const rooms = (nodes: Record<string, AnyNode>) =>
    extractRooms(Object.values(nodes).filter((node): node is WallNode => node.type === 'wall'))
  const endOf = (nodes: Record<string, AnyNode>, wallId: string, end: 'start' | 'end') =>
    findOpenWallEnds(nodes, LEVEL_ID).find((entry) => entry.wallId === wallId && entry.end === end)!

  test('snapping an endpoint seam detects a room and retains the repaired wall id', () => {
    const walls = [
      wall('wall_a', [0, 0], [2, 0]),
      wall('wall_b', [2.05, 0], [4, 0]),
      wall('wall_right', [4, 0], [4, 3]),
      wall('wall_top', [4, 3], [0, 3]),
      wall('wall_left', [0, 3], [0, 0]),
    ]
    const nodes = nodeMap(walls)
    expect(rooms(nodes)).toHaveLength(0)
    const result = planJoinOpenWallEnd(nodes, endOf(nodes, 'wall_a', 'end'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = apply(nodes, result.plan.changes)
    expect(after.wall_a).toMatchObject({ end: [2.05, 0] })
    expect(rooms(after)).toHaveLength(1)
    expect(findOpenWallEnds(after, LEVEL_ID)).toEqual([])
    expect(nodes.wall_a).toMatchObject({ end: [2, 0] })
  })

  test('the scene write commits a T repair, hosted opening and derived room as one undo step', () => {
    const host = wall('wall_host', [0, 0], [4, 0])
    const source = wall('wall_source', [2, 0.2], [2, 3])
    const door = DoorNode.parse({
      id: 'door_host',
      parentId: host.id,
      wallId: host.id,
      position: [3, 1.05, 0],
      width: 0.8,
    })
    const walls = [
      { ...host, children: [door.id] },
      source,
      wall('wall_right', [4, 0], [4, 3]),
      wall('wall_top', [4, 3], [2, 3]),
    ]
    const level = LevelNode.parse({
      id: LEVEL_ID,
      height: 3,
      children: walls.map((wall) => wall.id),
    })
    const previous = useScene.getState()
    const raf = globalThis.requestAnimationFrame
    const cancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    useScene.setState({
      nodes: nodeMap([level, ...walls, door]),
      rootNodeIds: [LEVEL_ID],
      collections: {},
      materials: {},
      dirtyNodes: new Set(),
      readOnly: false,
    })
    const stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces() {} }),
    })
    try {
      clearSceneHistory()
      const before = structuredClone(useScene.getState().nodes)
      const result = planJoinOpenWallEnd(before, endOf(before, source.id, 'start'))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      runAsSingleSceneHistoryStep(useScene, () =>
        useScene.getState().applyNodeChanges(result.plan.changes),
      )
      const after = useScene.getState().nodes
      const opening = after[door.id] as ReturnType<typeof DoorNode.parse>
      const parent = after[opening.parentId!] as WallNode
      expect(parent.children).toContain(door.id)
      expect(checkOpeningWithinWall(opening, parent, 3)).toEqual([])
      expect(Object.values(after).filter((node) => node.type === 'zone')).toHaveLength(1)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(before)
      useScene.temporal.getState().redo()
      expect(
        Object.values(useScene.getState().nodes).filter((node) => node.type === 'zone'),
      ).toHaveLength(1)
    } finally {
      stop()
      useScene.setState(previous)
      clearSceneHistory()
      globalThis.requestAnimationFrame = raf
      globalThis.cancelAnimationFrame = cancel
    }
  })

  test('a T join splits the host and preserves openings on the host and repaired wall', () => {
    const source = wall('wall_source', [2, 0.2], [2, 3])
    const host = wall('wall_host', [0, 0], [4, 0])
    const sourceDoor = DoorNode.parse({
      id: 'door_source',
      parentId: source.id,
      wallId: source.id,
      position: [1, 1.05, 0],
      width: 0.8,
    })
    const hostDoor = DoorNode.parse({
      id: 'door_host',
      parentId: host.id,
      wallId: host.id,
      position: [3, 1.05, 0],
      width: 0.8,
    })
    const nodes = nodeMap([
      { ...source, children: [sourceDoor.id] },
      { ...host, children: [hostDoor.id] },
      sourceDoor,
      hostDoor,
      wall('wall_right', [4, 0], [4, 3]),
      wall('wall_top', [4, 3], [2, 3]),
    ])
    expect(rooms(nodes)).toHaveLength(0)
    const result = planJoinOpenWallEnd(nodes, endOf(nodes, source.id, 'start'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = apply(nodes, result.plan.changes)
    expect(after[source.id]).toMatchObject({ start: [2, 0] })
    expect(after[sourceDoor.id]).toMatchObject({ position: [1.2, 1.05, 0], wallId: source.id })
    expect(after[host.id]).toBeUndefined()
    for (const id of [sourceDoor.id, hostDoor.id]) {
      const door = after[id] as ReturnType<typeof DoorNode.parse>
      const parent = after[door.parentId!] as WallNode
      expect(parent.children).toContain(id)
      expect(checkOpeningWithinWall(door, parent, 3)).toEqual([])
    }
    expect(rooms(after)).toHaveLength(1)
    expect(endOf(after, source.id, 'start')).toBeUndefined()
  })

  test('trims an overshoot and refuses to trim through a hosted opening', () => {
    const source = wall('wall_source', [2, -0.2], [2, 3])
    const host = wall('wall_host', [0, 0], [4, 0])
    const nodes = nodeMap([source, host])
    const open = endOf(nodes, source.id, 'start')
    const result = planJoinOpenWallEnd(nodes, open)
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(apply(nodes, result.plan.changes)[source.id]).toMatchObject({
        start: [2, 0],
        end: [2, 3],
      })
    const door = DoorNode.parse({
      id: 'door_trim',
      parentId: source.id,
      wallId: source.id,
      position: [0.45, 1.05, 0],
      width: 0.8,
    })
    expect(planJoinOpenWallEnd(nodeMap([source, host, door]), open)).toEqual({
      ok: false,
      reason: 'attachment-outside-wall',
    })
  })

  test('preserves an opening straddling a T join by retaining its unsplit host', () => {
    const host = wall('wall_host', [0, 0], [4, 0])
    const source = wall('wall_source', [2, 0.2], [2, 3])
    const door = DoorNode.parse({
      id: 'door_host',
      parentId: host.id,
      wallId: host.id,
      position: [2, 1.05, 0],
      width: 0.8,
    })
    const nodes = nodeMap([host, source, door])
    const result = planJoinOpenWallEnd(nodes, endOf(nodes, source.id, 'start'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.changes.delete).not.toContain(host.id)
    expect(apply(nodes, result.plan.changes)[door.id]).toEqual(door)
  })

  test('joining either end of a facing pair slides the walls along their own axes, never tilting one', () => {
    const nodes = nodeMap([
      wall('wall_bottom', [-4.5, 1], [0, 1]),
      wall('wall_right', [0, 1.09], [0, 5.5]),
      wall('wall_top', [0, 5.5], [-4.5, 5.5]),
      wall('wall_left', [-4.5, 5.5], [-4.5, 1]),
    ])
    for (const [wallId, end] of [
      ['wall_bottom', 'end'],
      ['wall_right', 'start'],
    ] as const) {
      const result = planJoinOpenWallEnd(nodes, endOf(nodes, wallId, end))
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const after = apply(nodes, result.plan.changes)
      expect(after.wall_bottom).toMatchObject({ start: [-4.5, 1], end: [0, 1] })
      expect(after.wall_right).toMatchObject({ start: [0, 1], end: [0, 5.5] })
      expect(rooms(after)).toHaveLength(1)
    }
  })

  test('an end short of a slanted host runs on along its own direction to meet it', () => {
    const nodes = nodeMap([
      wall('wall_host', [0, 0], [4, 4]),
      wall('wall_source', [3, -2], [3, 2.8]),
    ])
    const result = planJoinOpenWallEnd(nodes, endOf(nodes, 'wall_source', 'end'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const source = apply(nodes, result.plan.changes).wall_source as WallNode
    expect(source.start).toEqual([3, -2])
    expect(source.end[0]).toBeCloseTo(3, 9)
    expect(source.end[1]).toBeCloseTo(3, 9)
  })

  test('drop rejoins both moved ends within 5 cm even when the room graph already joins their bodies', () => {
    const source = wall('wall_source', [1, 0.04], [1, 2.96])
    const nodes = nodeMap([
      source,
      wall('wall_bottom', [0, 0], [4, 0]),
      wall('wall_top', [4, 3], [0, 3]),
    ])
    const changes = planWallEndRejoins(nodes, [source.id], 0.05, {
      create: [],
      delete: [],
      update: [{ id: source.id, data: { start: [2, 0.04], end: [2, 2.96] } }],
    })
    const after = apply(nodes, changes)
    expect(after[source.id]).toMatchObject({ start: [2, 0], end: [2, 3] })
    expect(changes.delete).toHaveLength(2)
    expect(changes.create).toHaveLength(4)
    const moved = { id: source.id, data: { start: [2, 0.04], end: [2, 2.96] } } as const
    const far = planWallEndRejoins(nodes, [source.id], 0.02, {
      create: [],
      delete: [],
      update: [moved],
    })
    expect(far).toEqual({ create: [], delete: [], update: [moved] })
  })

  test('drop leaves the far end of a linked wall where it was', () => {
    const moved = wall('wall_moved', [1, 0], [1, 3])
    const linked = wall('wall_linked', [1, 3], [3, 3.04])
    const nodes = nodeMap([moved, linked, wall('wall_host', [3, 0], [3, 5])])
    const update = [
      { id: moved.id, data: { start: [1.5, 0], end: [1.5, 3] } },
      { id: linked.id, data: { start: [1.5, 3] } },
    ] as WallTopologyChanges['update']
    expect(
      planWallEndRejoins(nodes, [moved.id, linked.id], 0.05, { create: [], delete: [], update }),
    ).toEqual({ create: [], delete: [], update })
  })

  test('refuses stale endpoints and cross-level repair targets', () => {
    const source = wall('wall_source', [0, 0], [2, 0])
    const target = wall('wall_target', [2.05, 0], [4, 0])
    const nodes = nodeMap([source, target])
    const open = endOf(nodes, source.id, 'end')
    expect(planJoinOpenWallEnd(nodes, { ...open, point: [1, 0] })).toEqual({
      ok: false,
      reason: 'stale-end',
    })
    expect(
      planJoinOpenWallEnd({ ...nodes, [target.id]: { ...target, parentId: 'level_other' } }, open),
    ).toEqual({ ok: false, reason: 'no-target' })
  })

  test('joins a curved source without replacing its arc or invalidating its opening', () => {
    const source = WallNode.parse({
      id: 'wall_curve_source',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })
    const target = wall('wall_target', [4.1, 0], [4.1, 3])
    const door = DoorNode.parse({
      id: 'door_curve_source',
      parentId: source.id,
      wallId: source.id,
      position: [2, 1.05, 0],
      width: 0.8,
    })
    const nodes = nodeMap([{ ...source, children: [door.id] }, target, door])
    const result = planJoinOpenWallEnd(nodes, endOf(nodes, source.id, 'end'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = apply(nodes, result.plan.changes)
    const repaired = after[source.id] as WallNode
    expect(repaired).toMatchObject({ end: [4.1, 0], curveOffset: 1, children: [door.id] })
    expect(
      checkOpeningWithinWall(after[door.id] as ReturnType<typeof DoorNode.parse>, repaired, 3),
    ).toEqual([])
  })
})
