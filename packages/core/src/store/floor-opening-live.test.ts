import { expect, test } from 'bun:test'
import { createMezzanine } from '../commands/structure/create-mezzanine'
import { createZone } from '../commands/structure/create-zone'
import { cutFloorOpening, removeFloorOpening } from '../commands/structure/floor-opening'
import { setFloorFoundation } from '../commands/structure/set-floor-foundation'
import { structureChangeBatch } from '../commands/structure/shared'
import { initSpatialGridSync } from '../hooks/spatial-grid/spatial-grid-sync'
import { area, difference, union } from '../lib/polygon-boolean'
import {
  initSpaceDetectionSync,
  pauseSpaceDetection,
  resumeSpaceDetection,
} from '../lib/space-detection'
import {
  BuildingNode,
  generateId,
  LevelNode,
  type SlabNode,
  StairNode,
  StairSegmentNode,
} from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { authorStairOpeningPatches } from '../systems/owned-floor-openings'
import { initializeStairOpeningSync } from '../systems/stair/stair-opening-system'
import { resolveStairTotalRise } from '../systems/stair/stair-rise'
import { reconcileStructureOnLoad } from '../utils/reconcile-structure-on-load'
import useScene, { clearSceneHistory } from './use-scene'

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

test.each([false, true])(
  'a live opening cuts both surfaces and undoes (paused: %s)',
  async (paused) => {
    const frames = {
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
    }
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = () => {}
    const building = BuildingNode.parse({
      id: 'building_live_opening',
      children: ['level_live_0', 'level_live_1'],
    })
    const ground = LevelNode.parse({ id: 'level_live_0', parentId: building.id, level: 0 })
    const upper = LevelNode.parse({ id: 'level_live_1', parentId: building.id, level: 1 })
    useScene.setState({
      nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
      rootNodeIds: [building.id],
      dirtyNodes: new Set(),
      materials: {},
      collections: {},
      readOnly: false,
    })
    clearSceneHistory()
    const stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    const solid = (levelId: string, type: 'slab' | 'ceiling') =>
      Object.values(useScene.getState().nodes)
        .filter(
          (node) => node.parentId === levelId && node.type === type && node.boundary === 'auto',
        )
        .reduce(
          (sum, node) =>
            sum +
            area(
              difference(
                node.polygon,
                union(node.holes.map((hole) => ({ outer: hole, holes: [] }))),
              ),
            ),
          0,
        )
    try {
      let upperRoomId = ''
      for (const levelId of [ground.id, upper.id]) {
        const plan = createZone(useScene.getState().nodes, {
          levelId,
          polygon: rect(0, 0, 8, 5),
          enclose: true,
          mintId: generateId,
          name: 'Room',
        })
        useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
        if (levelId === upper.id) upperRoomId = plan.zoneId
      }
      clearSceneHistory()
      const beforePlate = solid(upper.id, 'slab')
      const beforeCeiling = solid(ground.id, 'ceiling')
      const plan = cutFloorOpening(useScene.getState().nodes, {
        zoneId: upperRoomId,
        polygon: rect(2, 1, 4, 2),
        mintId: () => 'floor-opening_live_cut',
      })
      expect(
        plan.changes.some(
          (change) =>
            change.op === 'update' && useScene.getState().nodes[change.id]?.type === 'slab',
        ),
      ).toBe(false)
      if (paused) pauseSpaceDetection()
      useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
      if (paused) resumeSpaceDetection()
      expect(beforePlate - solid(upper.id, 'slab')).toBeCloseTo(2)
      expect(beforeCeiling - solid(ground.id, 'ceiling')).toBeCloseTo(2)

      useScene.temporal.getState().undo()
      await Promise.resolve()
      expect(solid(upper.id, 'slab')).toBeCloseTo(beforePlate)
      expect(solid(ground.id, 'ceiling')).toBeCloseTo(beforeCeiling)
      useScene.temporal.getState().redo()
      await Promise.resolve()
      expect(beforePlate - solid(upper.id, 'slab')).toBeCloseTo(2)
      expect(beforeCeiling - solid(ground.id, 'ceiling')).toBeCloseTo(2)

      if (paused) pauseSpaceDetection()
      useScene
        .getState()
        .updateNodes([{ id: 'floor-opening_live_cut', data: { polygon: rect(2, 1, 5, 2) } }])
      if (paused) resumeSpaceDetection()
      expect(beforePlate - solid(upper.id, 'slab')).toBeCloseTo(3)
      expect(beforeCeiling - solid(ground.id, 'ceiling')).toBeCloseTo(3)

      const removal = removeFloorOpening(useScene.getState().nodes, 'floor-opening_live_cut')
      if (paused) pauseSpaceDetection()
      useScene.getState().applyNodeChanges(structureChangeBatch(removal.changes))
      if (paused) resumeSpaceDetection()
      expect(solid(upper.id, 'slab')).toBeCloseTo(beforePlate)
      expect(solid(ground.id, 'ceiling')).toBeCloseTo(beforeCeiling)

      const mezzanine = createMezzanine(useScene.getState().nodes, {
        hostZoneId: upperRoomId,
        polygon: rect(1, 1, 7, 4),
        elevation: 1.5,
        mintId: generateId,
      })
      expect(mezzanine.conflicts).toBeUndefined()
      useScene.getState().applyNodeChanges(structureChangeBatch(mezzanine.changes))
      const mezzArea = () =>
        Object.values(useScene.getState().nodes)
          .filter((node) => node.type === 'slab' && node.zoneIds?.includes(mezzanine.zoneId))
          .reduce(
            (sum, node) =>
              sum +
              area(
                difference(
                  node.polygon,
                  union(node.holes.map((hole) => ({ outer: hole, holes: [] }))),
                ),
              ),
            0,
          )
      const beforeMezz = mezzArea()
      const hatch = cutFloorOpening(useScene.getState().nodes, {
        zoneId: mezzanine.zoneId,
        polygon: rect(2, 1.5, 4, 2.5),
        mintId: () => 'floor-opening_live_hatch',
      })
      if (paused) pauseSpaceDetection()
      useScene.getState().applyNodeChanges(structureChangeBatch(hatch.changes))
      if (paused) resumeSpaceDetection()
      expect(beforeMezz - mezzArea()).toBeCloseTo(2)
      expect(solid(upper.id, 'slab') - mezzArea()).toBeCloseTo(beforePlate)
    } finally {
      if (paused) resumeSpaceDetection()
      stop()
      clearSceneHistory()
      Object.assign(globalThis, frames)
    }
  },
)

test('stair edits own the live floor and ceiling cuts in one undo step', async () => {
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  const building = BuildingNode.parse({
    id: 'building_live_stair',
    children: ['level_live_stair_0', 'level_live_stair_1'],
  })
  const ground = LevelNode.parse({ id: 'level_live_stair_0', parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ id: 'level_live_stair_1', parentId: building.id, level: 1 })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  clearSceneHistory()
  const stopStructure = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const stopStair = initializeStairOpeningSync()
  const settle = async () => {
    for (let index = 0; index < 4; index++) await Promise.resolve()
  }
  const owned = () =>
    Object.values(useScene.getState().nodes).filter(
      (node) => node.type === 'floor-opening' && node.ownerId === 'stair_live_owned',
    )
  const cut = (levelId: string, type: 'slab' | 'ceiling') =>
    Object.values(useScene.getState().nodes).some(
      (node) =>
        node.parentId === levelId &&
        node.type === type &&
        node.holeMetadata.some(
          (entry) =>
            entry.source === 'floor-opening' &&
            owned().some((opening) => opening.id === entry.openingId),
        ),
    )
  try {
    for (const levelId of [ground.id, upper.id]) {
      const plan = createZone(useScene.getState().nodes, {
        levelId,
        polygon: rect(0, 0, 8, 5),
        enclose: true,
        mintId: generateId,
      })
      useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    }
    await settle()
    clearSceneHistory()
    const stair = StairNode.parse({
      id: 'stair_live_owned',
      parentId: ground.id,
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      position: [3, 0, 1],
      children: ['sseg_live_owned'],
    })
    const segment = StairSegmentNode.parse({
      id: 'sseg_live_owned',
      parentId: stair.id,
      length: 3,
      height: 3,
      width: 1,
    })
    useScene.getState().applyNodeChanges(
      structureChangeBatch([
        { op: 'create', node: stair },
        { op: 'create', node: segment },
      ]),
    )
    await settle()
    expect(owned()).toHaveLength(2)
    expect(cut(upper.id, 'slab')).toBe(true)
    expect(cut(ground.id, 'ceiling')).toBe(true)
    useScene.getState().updateNode(stair.id, { position: [4, 0, 1] })
    await settle()
    expect(owned()).toHaveLength(2)
    expect(
      owned().every(
        (opening) => opening.type === 'floor-opening' && opening.polygon.some(([x]) => x > 4),
      ),
    ).toBe(true)
    useScene.temporal.getState().undo()
    await settle()
    expect(
      useScene.getState().nodes[stair.id]?.type === 'stair' &&
        useScene.getState().nodes[stair.id].position[0],
    ).toBe(3)
    expect(cut(upper.id, 'slab')).toBe(true)
    useScene.temporal.getState().redo()
    await settle()
    expect(
      useScene.getState().nodes[stair.id]?.type === 'stair' &&
        useScene.getState().nodes[stair.id].position[0],
    ).toBe(4)
    useScene.getState().deleteNodes([stair.id, segment.id])
    await settle()
    expect(owned()).toHaveLength(0)
    expect(cut(upper.id, 'slab')).toBe(false)
    expect(cut(ground.id, 'ceiling')).toBe(false)
    useScene.temporal.getState().undo()
    await settle()
    expect(owned()).toHaveLength(2)
    expect(cut(upper.id, 'slab')).toBe(true)
    expect(cut(ground.id, 'ceiling')).toBe(true)
  } finally {
    stopStair()
    stopStructure()
    clearSceneHistory()
    globalThis.requestAnimationFrame = previousFrame
    globalThis.cancelAnimationFrame = previousCancel
  }
})

test('a stair opening reshaped in plan cuts the floor and ceiling to that shape and keeps it', async () => {
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  const building = BuildingNode.parse({
    id: 'building_shaped_stair',
    children: ['level_shaped_stair_0', 'level_shaped_stair_1'],
  })
  const ground = LevelNode.parse({ id: 'level_shaped_stair_0', parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ id: 'level_shaped_stair_1', parentId: building.id, level: 1 })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  clearSceneHistory()
  const stopStructure = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const stopStair = initializeStairOpeningSync()
  const settle = async () => {
    for (let index = 0; index < 4; index++) await Promise.resolve()
  }
  const nodes = () => useScene.getState().nodes
  const owned = () =>
    Object.values(nodes()).filter(
      (node) => node.type === 'floor-opening' && node.ownerId === 'stair_shaped',
    )
  const holes = (levelId: string, type: 'slab' | 'ceiling') =>
    Object.values(nodes()).flatMap((node) =>
      node.parentId === levelId && node.type === type
        ? node.holes.map((outer) => ({ outer, holes: [] }))
        : [],
    )
  try {
    for (const levelId of [ground.id, upper.id]) {
      const plan = createZone(nodes(), {
        levelId,
        polygon: rect(0, 0, 8, 5),
        enclose: true,
        mintId: generateId,
      })
      useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    }
    await settle()
    const stair = StairNode.parse({
      id: 'stair_shaped',
      parentId: ground.id,
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      position: [3, 0, 1],
      children: ['sseg_shaped'],
    })
    const segment = StairSegmentNode.parse({
      id: 'sseg_shaped',
      parentId: stair.id,
      length: 3,
      height: 3,
      width: 1,
    })
    useScene.getState().applyNodeChanges(
      structureChangeBatch([
        { op: 'create', node: stair },
        { op: 'create', node: segment },
      ]),
    )
    await settle()
    const floorOpening = owned().find(
      (node) => node.type === 'floor-opening' && node.drawnOn === 'floor',
    )!
    // Widen the opening by half a metre on the +X side, as the plan's edge handle does.
    const widened = rect(2.5, 1, 4, 4)
    const patches = authorStairOpeningPatches(nodes(), floorOpening.id, widened)
    expect(patches).toHaveLength(2)
    useScene.getState().updateNodes(patches)
    await settle()
    const inside = [3.75, 2.5] as [number, number]
    expect(area(difference(holes(upper.id, 'slab'), [{ outer: widened, holes: [] }]))).toBeLessThan(
      1e-6,
    )
    expect(area(holes(upper.id, 'slab'))).toBeCloseTo(area([{ outer: widened, holes: [] }]), 3)
    expect(
      area(
        union([
          ...holes(ground.id, 'ceiling'),
          {
            outer: [inside, [inside[0] + 0.01, inside[1]], [inside[0], inside[1] + 0.01]],
            holes: [],
          },
        ]),
      ),
    ).toBeCloseTo(area(holes(ground.id, 'ceiling')), 4)
    // Touching the stair (a reselect re-syncs it) keeps the drawn shape.
    useScene.getState().updateNode(stair.id, { name: 'Main stair' })
    await settle()
    expect(area(holes(upper.id, 'slab'))).toBeCloseTo(1.5 * 3, 3)
    // Moving the stair carries the drawn shape along.
    useScene.getState().updateNode(stair.id, { position: [4, 0, 1] })
    await settle()
    const moved = owned().find((node) => node.type === 'floor-opening' && node.drawnOn === 'floor')
    expect(
      moved?.type === 'floor-opening' && Math.max(...moved.polygon.map(([x]) => x)),
    ).toBeCloseTo(5)
    expect(area(holes(upper.id, 'slab'))).toBeCloseTo(1.5 * 3, 3)
    // A reload keeps it.
    const reloaded = reconcileStructureOnLoad(nodes()).nodes
    const plateHoles = Object.values(reloaded).flatMap((node) =>
      node.parentId === upper.id && node.type === 'slab'
        ? node.holes.map((outer) => ({ outer, holes: [] }))
        : [],
    )
    expect(area(plateHoles)).toBeCloseTo(1.5 * 3, 3)
  } finally {
    stopStair()
    stopStructure()
    clearSceneHistory()
    globalThis.requestAnimationFrame = previousFrame
    globalThis.cancelAnimationFrame = previousCancel
  }
})

test('a stair that follows its levels re-rises live when the floor above thickens or a storey grows', async () => {
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  const building = BuildingNode.parse({
    id: 'building_rise_stair',
    children: ['level_rise_stair_0', 'level_rise_stair_1'],
  })
  const ground = LevelNode.parse({ id: 'level_rise_stair_0', parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ id: 'level_rise_stair_1', parentId: building.id, level: 1 })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  clearSceneHistory()
  const stopGrid = initSpatialGridSync()
  const stopStructure = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const stopStair = initializeStairOpeningSync()
  const settle = async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve()
  }
  const nodes = () => useScene.getState().nodes
  const stairNode = () => nodes()['stair_rise' as never] as StairNode
  const flight = () => (nodes()['sseg_rise' as never] as StairSegmentNode).height
  const rise = () => resolveStairTotalRise(stairNode(), nodes())
  try {
    for (const levelId of [ground.id, upper.id]) {
      const plan = createZone(nodes(), {
        levelId,
        polygon: rect(0, 0, 8, 5),
        enclose: true,
        mintId: generateId,
      })
      useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    }
    await settle()
    const stair = StairNode.parse({
      id: 'stair_rise',
      parentId: ground.id,
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      uniformRisers: true,
      position: [3, 0, 1],
      children: ['sseg_rise'],
    })
    const segment = StairSegmentNode.parse({
      id: 'sseg_rise',
      parentId: stair.id,
      length: 3,
      height: 2.5,
      width: 1,
      stepCount: 15,
    })
    useScene.getState().applyNodeChanges(
      structureChangeBatch([
        { op: 'create', node: stair },
        { op: 'create', node: segment },
      ]),
    )
    await settle()
    const start = rise()
    expect(flight()).toBeCloseTo(start, 4)
    // A thicker floor above: the stair still lands on its top, no reload.
    const plate = Object.values(nodes()).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.parentId === upper.id && node.plateRole === 'base',
    )!
    const thicker = 0.45 - plate.thickness
    useScene
      .getState()
      .applyNodeChanges(
        structureChangeBatch(
          setFloorFoundation(nodes(), { slabId: plate.id, patch: { thickness: 0.45 } }).changes,
        ),
      )
    await settle()
    expect(rise()).toBeCloseTo(start + thicker, 4)
    expect(flight()).toBeCloseTo(start + thicker, 4)
    // A custom rise holds; back to Follows level it re-reaches the floor.
    useScene.getState().updateNode(stair.id, { totalRise: 2.5 })
    await settle()
    expect(flight()).toBeCloseTo(2.5, 4)
    useScene.getState().updateNode(stair.id, { totalRise: undefined })
    await settle()
    expect(flight()).toBeCloseTo(start + thicker, 4)
    // A taller storey below: the risers recompute live.
    const storey = getStoredLevelHeight(nodes()[ground.id] as LevelNode)
    useScene.getState().updateNode(ground.id, { height: storey + 0.3 })
    await settle()
    expect(rise()).toBeCloseTo(start + thicker + 0.3, 4)
    expect(flight()).toBeCloseTo(start + thicker + 0.3, 4)
  } finally {
    stopStair()
    stopStructure()
    stopGrid()
    clearSceneHistory()
    globalThis.requestAnimationFrame = previousFrame
    globalThis.cancelAnimationFrame = previousCancel
  }
})
