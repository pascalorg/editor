import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  duplicateNodeOutput,
  duplicateNodeTool,
  moveNodeOutput,
  moveNodeTool,
} from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { cloneNodesInto, collectSubtree } from '../registry/subtree'
import {
  type AnyNode,
  type AnyNodeId,
  CeilingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
  WallNode,
  WindowNode,
} from '../schema'
import { applySceneChanges } from './apply-changes'
import { duplicateNode } from './duplicate-node'
import { AGENT_OPERATIONS } from './index'
import { moveNode } from './move-node'
import type { SceneNodes } from './types'

const context = { activeLevelId: null }

const asset = (extra: Record<string, unknown> = {}) => ({
  id: 'chair',
  name: 'Chair',
  category: 'seating',
  thumbnail: '/items/chair/thumbnail.webp',
  src: '/items/chair/model.glb',
  dimensions: [0.5, 0.9, 0.5] as [number, number, number],
  ...extra,
})

/**
 * One level holding one node per host class: a 6 m wall (z=0) with a door at 1 m, a window at
 * 3 m and a wall shelf at 5 m; a ceiling with a lamp under it; a chair on the floor; a roof
 * segment carrying a skylight in segment-local coordinates.
 */
function scene() {
  const level = LevelNode.parse({ id: 'level_a' })
  const upper = LevelNode.parse({ id: 'level_b', level: 1 })
  const wall = WallNode.parse({
    id: 'wall_a',
    parentId: level.id,
    start: [0, 0],
    end: [6, 0],
    thickness: 0.2,
    height: 2.5,
    children: ['door_a', 'window_a', 'item_shelf'],
  })
  const door = DoorNode.parse({
    id: 'door_a',
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const win = WindowNode.parse({
    id: 'window_a',
    parentId: wall.id,
    wallId: wall.id,
    position: [3, 1.25, 0],
    width: 1.2,
    height: 1.0,
  })
  const shelf = ItemNode.parse({
    id: 'item_shelf',
    parentId: wall.id,
    wallId: wall.id,
    wallT: 5 / 6,
    side: 'front',
    position: [5, 1, 0],
    asset: asset({
      id: 'wall-shelf',
      name: 'Wall shelf',
      attachTo: 'wall',
      dimensions: [1, 0.6, 0.3],
    }),
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_a',
    parentId: level.id,
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    children: ['item_lamp'],
  })
  const lamp = ItemNode.parse({
    id: 'item_lamp',
    parentId: ceiling.id,
    position: [2, -0.3, 2],
    asset: asset({
      id: 'pendant',
      name: 'Pendant',
      attachTo: 'ceiling',
      dimensions: [0.3, 0.3, 0.3],
    }),
  })
  const chair = ItemNode.parse({
    id: 'item_chair',
    parentId: level.id,
    position: [1, 0, 2],
    rotation: [0, 0, 0],
    asset: asset(),
  })
  const roof = RoofNode.parse({ id: 'roof_a', parentId: level.id, children: ['rseg_a'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_a',
    parentId: roof.id,
    children: ['skylight_a'],
  })
  const skylight = SkylightNode.parse({
    id: 'skylight_a',
    parentId: segment.id,
    roofSegmentId: segment.id,
    position: [0.5, 0, 0.5],
  })
  const all = [level, upper, wall, door, win, shelf, ceiling, lamp, chair, roof, segment, skylight]
  return Object.fromEntries(all.map((node) => [node.id, node])) as unknown as SceneNodes
}

const refusalCode = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal')
}

const moved = (nodes: SceneNodes, input: never) => {
  const { result, changes } = moveNode(nodes, input, context)
  return { result, after: applySceneChanges(nodes as never, changes) as SceneNodes }
}

describe('move_node', () => {
  test('is registered once, under the shared contract', () => {
    expect(AGENT_OPERATIONS.move_node).toBe(moveNode)
    expect(moveNodeTool.name).toBe('move_node')
    expect(z.object(moveNodeTool.input).safeParse({ id: 'door_a', by: [1, 0] }).success).toBe(true)
    expect(z.object(moveNodeTool.input).safeParse({ id: 'door_a' }).success).toBe(true)
  })

  test('a door slides along its wall by a plan delta, seated as add_door seats it', () => {
    const { result, after } = moved(scene(), { id: 'door_a', by: [0.5, 0] } as never)
    expect(z.object(moveNodeOutput).strict().parse(result)).toEqual(result)
    expect(result).toMatchObject({ id: 'door_a', host: 'wall', hostId: 'wall_a', clamped: false })
    expect((after.door_a as DoorNode).position).toEqual([1.5, 1.05, 0])
  })

  test('a door moved past the start of its wall clamps onto the wall and says so', () => {
    const { result, after } = moved(scene(), { id: 'door_a', to: [-5, 0] } as never)
    expect(result.clamped).toBe(true)
    // A 0.9 m door: its centre stops half a width from the wall's start.
    expect((after.door_a as DoorNode).position[0]).toBeCloseTo(0.45, 6)
  })

  test('a door with sidelights clamps and overlaps by its whole cutout, not its leaf', () => {
    const wide = scene()
    ;(wide.door_a as DoorNode).sidelightLeft = 0.4
    ;(wide.door_a as DoorNode).sidelightRight = 0.4
    const { result, after } = moved(wide, { id: 'door_a', to: [-5, 0] } as never)
    expect(result.clamped).toBe(true)
    // 0.9 m leaf + two 0.4 m sidelights: the cutout's edge stops at the wall's start.
    expect((after.door_a as DoorNode).position[0]).toBeCloseTo(0.85, 6)
    // The leaf alone would clear the window; the sidelights reach it.
    expect(
      refusalCode(() => moveNode(wide, { id: 'door_a', to: [2.0, 0] } as never, context)),
    ).toBe('opening_overlap')
  })

  test('a door moved onto the window is refused, unless forced as with Alt in the editor', () => {
    expect(
      refusalCode(() => moveNode(scene(), { id: 'door_a', to: [3, 0] } as never, context)),
    ).toBe('opening_overlap')
    const { after } = moved(scene(), { id: 'door_a', to: [3, 0], force: true } as never)
    expect((after.door_a as DoorNode).position[0]).toBe(3)
  })

  test('a window takes a new sill height through y, clamped under the wall top', () => {
    const { result, after } = moved(scene(), { id: 'window_a', by: [0, 0], y: 0.9 } as never)
    expect(result.host).toBe('wall')
    // Sill 0.9 m + half of its 1 m height is its stored centre.
    expect((after.window_a as WindowNode).position).toEqual([3, 1.4, 0])
    const high = moved(scene(), { id: 'window_a', by: [0, 0], y: 2.2 } as never)
    expect(high.result.clamped).toBe(true)
    expect((high.after.window_a as WindowNode).position[1]).toBeCloseTo(2.0, 6)
  })

  test('a wall item slides along the wall, its wallT following, clamped in span and height', () => {
    const { after } = moved(scene(), { id: 'item_shelf', to: [4.3, 0.4], y: 1.2 } as never)
    const shelf = after.item_shelf as ItemNode
    expect(shelf.position[0]).toBeCloseTo(4.3, 6)
    expect(shelf.position[1]).toBe(1.2)
    expect(shelf.wallT).toBeCloseTo(4.3 / 6, 6)
    expect(shelf.wallId).toBe('wall_a')
    expect(shelf.parentId).toBe('wall_a')
  })

  test('a ceiling item moves in plan under its ceiling, keeping its drop', () => {
    const { result, after } = moved(scene(), { id: 'item_lamp', to: [3, 3] } as never)
    expect(result).toMatchObject({ host: 'ceiling', hostId: 'ceiling_a' })
    expect((after.item_lamp as ItemNode).position).toEqual([3, -0.3, 3])
  })

  test('a floor item moves in plan and turns by degrees', () => {
    const { result, after } = moved(scene(), {
      id: 'item_chair',
      by: [1, -0.5],
      rotation: 90,
    } as never)
    expect(result.host).toBe('free')
    const chair = after.item_chair as ItemNode
    expect(chair.position).toEqual([2, 0, 1.5])
    expect(chair.rotation[1]).toBeCloseTo(Math.PI / 2, 9)
  })

  test('a roof piece moves in its segment-local plan, its anchored height kept', () => {
    const { result, after } = moved(scene(), { id: 'skylight_a', by: [0.25, -0.25] } as never)
    expect(result).toMatchObject({ host: 'roof', hostId: 'rseg_a' })
    expect((after.skylight_a as SkylightNode).position).toEqual([0.75, 0, 0.25])
  })

  test('a wall translates by a delta, its openings riding in wall-local seats', () => {
    const { after } = moved(scene(), { id: 'wall_a', by: [0, 2] } as never)
    const wall = after.wall_a as WallNode
    expect(wall.start).toEqual([0, 2])
    expect(wall.end).toEqual([6, 2])
    expect((after.door_a as DoorNode).position).toEqual([1, 1.05, 0])
    expect(
      refusalCode(() => moveNode(scene(), { id: 'wall_a', to: [1, 1] } as never, context)),
    ).toBe('move_to_ambiguous')
  })

  test('refusals name what cannot move and what to use instead', () => {
    expect(
      refusalCode(() => moveNode(scene(), { id: 'missing', by: [1, 0] } as never, context)),
    ).toBe('node_not_found')
    expect(
      refusalCode(() => moveNode(scene(), { id: 'level_a', by: [1, 0] } as never, context)),
    ).toBe('node_not_movable')
    expect(refusalCode(() => moveNode(scene(), { id: 'item_chair' } as never, context))).toBe(
      'move_target_required',
    )
    expect(
      refusalCode(() =>
        moveNode(scene(), { id: 'item_chair', to: [1, 1], by: [1, 1] } as never, context),
      ),
    ).toBe('move_target_ambiguous')
    expect(
      refusalCode(() =>
        moveNode(scene(), { id: 'door_a', by: [1, 0], rotation: 90 } as never, context),
      ),
    ).toBe('rotation_not_supported')
    expect(
      refusalCode(() =>
        moveNode(scene(), { id: 'item_chair', by: [1, 0], y: 1 } as never, context),
      ),
    ).toBe('height_not_applicable')
  })

  test('a curved wall refuses its openings, as the editor refuses them there', () => {
    const nodes = scene()
    const curved = { ...nodes, wall_a: { ...(nodes.wall_a as WallNode), curveOffset: 0.5 } }
    expect(
      refusalCode(() => moveNode(curved, { id: 'door_a', by: [1, 0] } as never, context)),
    ).toBe('curved_wall')
  })
})

describe('duplicate_node', () => {
  test('is registered once, under the shared contract', () => {
    expect(AGENT_OPERATIONS.duplicate_node).toBe(duplicateNode)
    expect(duplicateNodeTool.name).toBe('duplicate_node')
    expect(z.object(duplicateNodeTool.input).safeParse({ ids: ['door_a'] }).success).toBe(true)
  })

  test('a floor item copy is the node the editor duplicate makes: same fields, fresh id', () => {
    const nodes = scene()
    const { result, changes } = duplicateNode(nodes, { ids: ['item_chair'] } as never, context)
    expect(z.object(duplicateNodeOutput).strict().parse(result)).toEqual(result)
    const after = applySceneChanges(nodes as never, changes) as SceneNodes
    const copyId = (result.copies as { copyId: string }[])[0]?.copyId ?? ''
    // The editor's own duplicate path (duplicateWithoutMove) is collectSubtree + cloneNodesInto.
    const subtree = collectSubtree(nodes as Record<AnyNodeId, AnyNode>, 'item_chair' as AnyNodeId)
    if (!subtree) throw new Error('chair subtree missing')
    const editorClone = cloneNodesInto([subtree.root, ...subtree.descendants], {
      rootId: 'item_chair' as AnyNodeId,
      parentId: 'level_a' as AnyNodeId,
    }).nodes[0] as AnyNode
    const { id: _agentId, ...agentRest } = after[copyId] as AnyNode
    const { id: _editorId, ...editorRest } = editorClone
    expect(agentRest).toEqual(editorRest)
    expect(copyId).not.toBe('item_chair')
  })

  test('a wall copy carries its openings and shelf, hosted on the copy, offset as one', () => {
    const nodes = scene()
    const { result, changes } = duplicateNode(
      nodes,
      { ids: ['wall_a'], offset: [0, 3] } as never,
      context,
    )
    const after = applySceneChanges(nodes as never, changes) as SceneNodes
    const copyId = (result.copies as { copyId: string }[])[0]?.copyId ?? ''
    const wall = after[copyId] as WallNode
    expect(wall.start).toEqual([0, 3])
    expect(wall.end).toEqual([6, 3])
    expect(wall.children).toHaveLength(3)
    for (const childId of wall.children) {
      const child = after[childId] as DoorNode
      expect(child.parentId).toBe(copyId)
      expect(child.wallId).toBe(copyId)
    }
    expect(result.totalCreated).toBe(4)
  })

  test('a window copy stays on the same wall, offset along it', () => {
    const nodes = scene()
    const { result, changes } = duplicateNode(
      nodes,
      { ids: ['window_a'], offset: [1.4, 0] } as never,
      context,
    )
    const after = applySceneChanges(nodes as never, changes) as SceneNodes
    const copyId = (result.copies as { copyId: string }[])[0]?.copyId ?? ''
    const copy = after[copyId] as WindowNode
    expect(copy.parentId).toBe('wall_a')
    expect(copy.wallId).toBe('wall_a')
    expect(copy.position[0]).toBeCloseTo(4.4, 6)
    expect((after.wall_a as WallNode).children).toContain(copyId)
  })

  test('a ceiling lamp and a skylight copy onto their same hosts', () => {
    const nodes = scene()
    const { result, changes } = duplicateNode(
      nodes,
      { ids: ['item_lamp', 'skylight_a'], offset: [1, 0] } as never,
      context,
    )
    const after = applySceneChanges(nodes as never, changes) as SceneNodes
    const copies = result.copies as { sourceId: string; copyId: string }[]
    const lamp = after[copies.find((c) => c.sourceId === 'item_lamp')?.copyId ?? ''] as ItemNode
    const sky = after[copies.find((c) => c.sourceId === 'skylight_a')?.copyId ?? ''] as SkylightNode
    expect(lamp.parentId).toBe('ceiling_a')
    expect(lamp.position).toEqual([3, -0.3, 2])
    expect(sky.parentId).toBe('rseg_a')
    expect(sky.roofSegmentId).toBe('rseg_a')
    expect(sky.position).toEqual([1.5, 0, 0.5])
  })

  test('a selection copies across a level; a hosted root refuses the move', () => {
    const nodes = scene()
    const { result, changes } = duplicateNode(
      nodes,
      { ids: ['wall_a', 'item_chair'], targetLevelId: 'level_b' } as never,
      context,
    )
    const after = applySceneChanges(nodes as never, changes) as SceneNodes
    for (const copy of result.copies as { copyId: string }[]) {
      expect((after[copy.copyId] as AnyNode).parentId).toBe('level_b')
    }
    expect(
      refusalCode(() =>
        duplicateNode(nodes, { ids: ['door_a'], targetLevelId: 'level_b' } as never, context),
      ),
    ).toBe('hosted_root_level')
  })

  test('an id inside another copied subtree is skipped, not copied twice', () => {
    const { result } = duplicateNode(scene(), { ids: ['wall_a', 'door_a'] } as never, context)
    expect(result.skippedIds).toEqual(['door_a'])
    expect((result.copies as unknown[]).length).toBe(1)
  })

  test('refusals: unknown id, a level, and a roof each name their own tool', () => {
    expect(refusalCode(() => duplicateNode(scene(), { ids: ['missing'] } as never, context))).toBe(
      'node_not_found',
    )
    expect(refusalCode(() => duplicateNode(scene(), { ids: ['level_a'] } as never, context))).toBe(
      'duplicate_not_supported',
    )
    expect(refusalCode(() => duplicateNode(scene(), { ids: ['roof_a'] } as never, context))).toBe(
      'duplicate_not_supported',
    )
  })
})

test('moving an entry door refuses a transom above its resolved wall ceiling, even with force', () => {
  for (const planeBound of [false, true]) {
    const nodes = scene()
    ;(nodes.door_a as DoorNode).transomHeight = 1
    if (planeBound) delete (nodes.wall_a as WallNode).height
    expect(
      refusalCode(() =>
        moveNode(nodes, { id: 'door_a', by: [0.1, 0], force: true } as never, context),
      ),
    ).toBe('wall_too_low')
  }
})
