import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, DoorNode, WallNode } from '../../schema'
import { getWallCurveFrameAt } from './wall-curve'
import { planWallInsertion, planWallSplitAtPoint } from './wall-topology'

const LEVEL_ID = 'level_topology' as AnyNodeId

function nodeMap(nodes: AnyNode[]) {
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

describe('planWallInsertion', () => {
  test('rejects a covered draft before producing any host split changes', () => {
    const host = WallNode.parse({
      id: 'wall_covered',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
    })

    const plan = planWallInsertion(nodeMap([host]), {
      levelId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      joinRadius: 0.05,
    })

    expect(plan).toBeNull()
  })

  test('returns one atomic plan for host splits and inserted wall segments', () => {
    const horizontal = WallNode.parse({
      id: 'wall_horizontal',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
    })

    const plan = planWallInsertion(nodeMap([horizontal]), {
      levelId: LEVEL_ID,
      start: [2, -2],
      end: [2, 2],
      joinRadius: 0.05,
    })

    expect(plan).not.toBeNull()
    expect(plan?.changes.delete).toEqual([horizontal.id])
    expect(plan?.changes.update).toHaveLength(0)
    expect(plan?.changes.create).toHaveLength(4)
    expect(plan?.insertedWalls).toHaveLength(2)
    expect(plan?.insertedWalls[0]?.end).toEqual([2, 0])
    expect(plan?.insertedWalls[1]?.start).toEqual([2, 0])
  })

  test('joins at a nearby host endpoint without minting a sliver wall', () => {
    const host = WallNode.parse({
      id: 'wall_near_endpoint',
      parentId: LEVEL_ID,
      start: [2, -0.005],
      end: [2, 2],
    })

    const plan = planWallInsertion(nodeMap([host]), {
      levelId: LEVEL_ID,
      start: [-2, 0],
      end: [4, 0],
      joinRadius: 0.05,
    })

    expect(plan).not.toBeNull()
    expect(plan?.changes.delete).not.toContain(host.id)
    expect(plan?.insertedWalls).toHaveLength(2)
    expect(plan?.insertedWalls[0]?.end).toEqual(host.start)
    expect(plan?.insertedWalls[1]?.start).toEqual(host.start)
  })

  test('splits one curved host at every crossing without exposing intermediate mutations', () => {
    const curved = WallNode.parse({
      id: 'wall_curved',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })

    const plan = planWallInsertion(nodeMap([curved]), {
      levelId: LEVEL_ID,
      start: [1, -2],
      end: [1, 2],
      joinRadius: 0.05,
    })

    expect(plan).not.toBeNull()
    expect(plan?.changes.delete).toEqual([curved.id])
    const replacements = plan?.changes.create
      .map(({ node }) => node)
      .filter(
        (node): node is WallNode => node.type === 'wall' && !plan.insertedWalls.includes(node),
      )
    expect(replacements).toHaveLength(2)
    expect(replacements?.every((wall) => Math.abs(wall.curveOffset ?? 0) > 0)).toBe(true)
  })

  test('keeps an attached opening on the replacement segment that contains it', () => {
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

    const plan = planWallSplitAtPoint(nodeMap([host, door]), {
      levelId: LEVEL_ID,
      point: [3, 0.01],
      radius: 0.05,
    })

    expect(plan).not.toBeNull()
    expect(plan?.changes.delete).toEqual([host.id])
    expect(plan?.changes.create).toHaveLength(2)
    expect(plan?.changes.update).toHaveLength(1)
    const doorUpdate = plan?.changes.update[0]
    const newParent = plan?.changes.create.find(({ node }) => node.id === doorUpdate?.data.parentId)
    expect(newParent?.node.type).toBe('wall')
    expect(newParent?.node.type === 'wall' ? newParent.node.children : []).toContain(door.id)
  })

  test('splits the inserted wall when an opening prevents splitting the crossed host', () => {
    const door = DoorNode.parse({
      id: 'door_crossing',
      parentId: 'wall_crossing_blocked',
      wallId: 'wall_crossing_blocked',
      position: [2, 0, 0],
      width: 1,
    })
    const host = WallNode.parse({
      id: 'wall_crossing_blocked',
      parentId: LEVEL_ID,
      children: [door.id],
      start: [0, 0],
      end: [4, 0],
    })

    const plan = planWallInsertion(nodeMap([host, door]), {
      levelId: LEVEL_ID,
      start: [2, -2],
      end: [2, 2],
      joinRadius: 0.05,
    })

    expect(plan).not.toBeNull()
    expect(plan?.changes.delete).not.toContain(host.id)
    expect(plan?.insertedWalls).toHaveLength(2)
    expect(plan?.insertedWalls[0]?.end).toEqual([2, 0])
    expect(plan?.insertedWalls[1]?.start).toEqual([2, 0])
  })

  test('resolves onto a host but refuses to split through an opening', () => {
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
    const midpoint = getWallCurveFrameAt(host, 0.5).point

    const plan = planWallSplitAtPoint(nodeMap([host, door]), {
      levelId: LEVEL_ID,
      point: [midpoint.x, midpoint.y],
      radius: 0.05,
    })

    expect(plan?.point).toEqual([2, 0])
    expect(plan?.changes).toEqual({ create: [], update: [], delete: [] })
  })
})
