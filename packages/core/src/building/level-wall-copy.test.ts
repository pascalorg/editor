import { expect, test } from 'bun:test'
import { createZone } from '../commands/structure/create-zone'
import { structureChangeBatch } from '../commands/structure/shared'
import { FOUNDATION_CONSTRUCTIONS } from '../lib/foundation-construction'
import { foundationWallConstruction } from '../lib/foundation-wall'
import { initSpaceDetectionSync } from '../lib/space-detection'
import {
  type AnyNode,
  BuildingNode,
  generateId,
  LevelNode,
  type WallNode,
  WallNode as WallSchema,
  WindowNode,
} from '../schema'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { WALL_ASSEMBLY_PRESETS, wallAssemblyPatch } from '../systems/wall/wall-assembly'
import { buildExteriorWallCopy } from './level-wall-copy'

test('a new floor copies the exterior walls below in place, and its rooms come from them', async () => {
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  // A frame that runs in a microtask: a callback run inside the call would let the store
  // store the frame id after the flush cleared it, and a later test would cancel that id.
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0))
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  const building = BuildingNode.parse({ id: 'building_copy', children: ['level_copy_0'] })
  const ground = LevelNode.parse({
    id: 'level_copy_0',
    parentId: building.id,
    level: 0,
    height: 2.8,
  })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  } as never)
  clearSceneHistory()
  const stop = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const settle = async () => {
    for (let index = 0; index < 6; index++) await Promise.resolve()
  }
  const nodes = () => useScene.getState().nodes
  const walls = (levelId: string) =>
    Object.values(nodes()).filter(
      (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
    )
  try {
    const room = createZone(nodes(), {
      levelId: ground.id,
      polygon: [
        [0, 0],
        [8, 0],
        [8, 5],
        [0, 5],
      ],
      enclose: true,
      mintId: generateId,
    })
    useScene.getState().applyNodeChanges(structureChangeBatch(room.changes))
    await settle()
    const partition = WallSchema.parse({ parentId: ground.id, start: [4, 0], end: [4, 5] })
    const front = walls(ground.id).find((wall) => wall.start[1] === 0 && wall.end[1] === 0)!
    const window = WindowNode.parse({ parentId: front.id, position: [2, 1.2, 0] })
    useScene.getState().applyNodeChanges({
      create: [
        { node: partition, parentId: ground.id },
        { node: window, parentId: front.id },
      ],
    })
    await settle()
    const upper = LevelNode.parse({
      id: 'level_copy_1',
      parentId: building.id,
      level: 1,
      height: 2.8,
    })
    useScene.getState().applyNodeChanges({ create: [{ node: upper, parentId: building.id }] })
    await settle()

    const create = buildExteriorWallCopy({
      nodes: nodes(),
      fromLevelId: ground.id,
      toLevelId: upper.id,
    })
    expect(create).toHaveLength(4)
    const before = useScene.temporal.getState().pastStates.length
    useScene.getState().applyNodeChanges({ create })
    await settle()
    expect(useScene.temporal.getState().pastStates.length).toBe(before + 1)

    const copied = walls(upper.id)
    expect(copied).toHaveLength(4)
    expect(copied.every((wall) => wall.children.length === 0 && wall.height === undefined)).toBe(
      true,
    )
    const key = (wall: WallNode) => JSON.stringify([...[wall.start, wall.end].sort()])
    expect(copied.map(key).sort()).toEqual(
      walls(ground.id)
        .filter((wall) => wall.id !== partition.id)
        .map(key)
        .sort(),
    )
    const rooms = Object.values(nodes()).filter(
      (node) => node.type === 'zone' && node.parentId === upper.id && node.spaceRole === 'room',
    )
    expect(rooms).toHaveLength(1)
  } finally {
    stop()
    clearSceneHistory()
    useScene.getState().unloadScene()
    globalThis.requestAnimationFrame = previousFrame
    globalThis.cancelAnimationFrame = previousCancel
  }
})

test('foundation walls copied up from a basement take the exterior build given, walls copied down get the foundation', () => {
  const square: [number, number][] = [
    [-4, -4],
    [4, -4],
    [4, 4],
    [-4, 4],
  ]
  const building = BuildingNode.parse({
    id: 'building_basement_copy',
    children: ['level_basement_copy', 'level_main_copy'],
  })
  const basement = LevelNode.parse({
    id: 'level_basement_copy',
    parentId: building.id,
    level: -1,
    baseElevation: -2.5,
    height: 2.5,
  })
  const main = LevelNode.parse({
    id: 'level_main_copy',
    parentId: building.id,
    level: 0,
    height: 2.5,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, basement, main].map((node) => [node.id, node]),
  )
  const walls = (levelId: string, construction: Partial<WallNode>) =>
    square.map((start, at) =>
      WallSchema.parse({
        id: `wall_${levelId}_${at}`,
        parentId: levelId,
        start,
        end: square[(at + 1) % 4],
        ...construction,
      }),
    )
  const foundation = foundationWallConstruction(Object.values(FOUNDATION_CONSTRUCTIONS)[0]!)
  for (const wall of walls(basement.id, foundation)) nodes[wall.id] = wall
  const siding = wallAssemblyPatch(structuredClone(WALL_ASSEMBLY_PRESETS[0]!.assembly))
  const up = buildExteriorWallCopy({
    nodes,
    fromLevelId: basement.id,
    toLevelId: main.id,
    exteriorConstruction: siding,
  })
  expect(up).toHaveLength(4)
  for (const { node } of up) {
    expect(node.thickness).toBeCloseTo(siding.thickness!, 6)
    expect(node.assembly).toEqual(siding.assembly)
  }
  const above: Record<string, AnyNode> = Object.fromEntries(
    [building, basement, main].map((node) => [node.id, node]),
  )
  for (const wall of walls(main.id, siding)) above[wall.id] = wall
  const down = buildExteriorWallCopy({
    nodes: above,
    fromLevelId: main.id,
    toLevelId: basement.id,
    exteriorConstruction: siding,
  })
  expect(down).toHaveLength(4)
  for (const { node } of down) expect(node.assembly).not.toEqual(siding.assembly)
})
