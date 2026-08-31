import { describe, expect, test } from 'bun:test'
import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from '../../lib/terrain-field'
import { type AnyNode, type AnyNodeId, DoorNode, WallNode } from '../../schema'
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
