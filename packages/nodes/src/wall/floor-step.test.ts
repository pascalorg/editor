import { afterEach, expect, test } from 'bun:test'
import {
  computeWallSlabSupport,
  spatialGridManager,
  useScene,
  type WallTrimConfig,
} from '@pascal-app/core'
import { floorStepFixture } from '../../../core/src/systems/slab/__fixtures__/floor-step'
import { createSlabDependencyTracker } from '../slab/dependency-tracker'
import { resetWallTreatmentLevels, updateWallTreatmentLevels } from './system'
import {
  buildWallTreatmentLevelData,
  createWallTreatmentSelector,
  useWallTreatmentLevelData,
} from './treatment-level-data'
import { buildTrimGeometry, wallTreatmentProudOffsets } from './treatments'

const original = useScene.getState()
afterEach(() => {
  resetWallTreatmentLevels()
  spatialGridManager.clear()
  useScene.setState(original)
})
const trim: WallTrimConfig = {
  enabled: true,
  height: 0.1,
  proud: 0.02,
  profile: 'flat',
  sides: 'both',
}

test('each skirting sits on its room floor and stops at the floor opening', () => {
  const { divider, walls, slabs, nodes, door } = floorStepFixture()
  const wall = { ...divider, skirting: trim }
  useScene.setState({ nodes })
  const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
  const data = buildWallTreatmentLevelData(
    'level_step',
    walls,
    wallTreatmentProudOffsets(wall),
    new Map([[wall.id, support]]),
  )
  for (const [side, elevation] of [
    ['a', 0.05],
    ['b', -0.4],
  ] as const) {
    const geometry = buildTrimGeometry(wall, side, trim, 'skirting', [door], data)!
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y + support.elevation).toBeCloseTo(elevation, 6)
    expect(geometry.boundingBox!.max.y + support.elevation).toBeCloseTo(elevation + trim.height, 6)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++)
      expect(positions.getX(i) <= 1.5 || positions.getX(i) >= 2.5).toBe(true)
    geometry.dispose()
  }
})

test('a floor edit invalidates the skirting selector once without changing the wall', () => {
  const { divider, walls, slabs, nodes } = floorStepFixture()
  useScene.setState({ nodes, dirtyNodes: new Set(walls.map((wall) => wall.id)) })
  for (const node of Object.values(nodes)) spatialGridManager.handleNodeCreated(node, 'level_step')
  updateWallTreatmentLevels()
  const select = createWallTreatmentSelector(divider, [])
  const before = select(useWallTreatmentLevelData.getState())!
  const lower = { ...slabs[1]!, elevation: -0.6 }
  useScene.setState({ nodes: { ...nodes, [lower.id]: lower }, dirtyNodes: new Set() })
  spatialGridManager.handleNodeUpdated(lower, 'level_step')
  updateWallTreatmentLevels()
  const after = select(useWallTreatmentLevelData.getState())!
  expect(after).not.toBe(before)
  expect(after.supports!.get(divider.id)!.faceDatum.b[0]!.elevation).toBe(-0.6)
  updateWallTreatmentLevels()
  expect(select(useWallTreatmentLevelData.getState())).toBe(after)
})

test('moving and raising a door invalidate plate exposure even when the wall is unchanged', () => {
  const { divider, nodes, door, slabs } = floorStepFixture()
  const withDoor = { ...nodes, [divider.id]: { ...divider, children: [door.id] }, [door.id]: door }
  const update = createSlabDependencyTracker(withDoor)
  expect(update(withDoor)).toEqual([])
  const moved = {
    ...withDoor,
    [door.id]: { ...door, position: [3, 1, 0] as [number, number, number] },
  }
  expect(update(moved).sort()).toEqual(slabs.map((slab) => slab.id).sort())
  expect(update(moved)).toEqual([])
  expect(update({ ...moved, [door.id]: { ...door, position: [3, 2, 0] } }).sort()).toEqual(
    slabs.map((slab) => slab.id).sort(),
  )
})

test('unrelated live transforms and scene edits do not recompute wall support', async () => {
  const { spyOn } = await import('bun:test')
  const { useLiveTransforms } = await import('@pascal-app/core')
  const { walls, nodes } = floorStepFixture()
  useScene.setState({ nodes, dirtyNodes: new Set(walls.map((wall) => wall.id)) })
  for (const node of Object.values(nodes)) spatialGridManager.handleNodeCreated(node, 'level_step')
  updateWallTreatmentLevels()
  const spy = spyOn(spatialGridManager, 'getSlabSupportForWall')
  try {
    for (let i = 0; i < 20; i++) {
      useLiveTransforms.getState().set('item_drag', { position: [i, 0, 0], rotation: 0 })
      updateWallTreatmentLevels()
    }
    useScene.setState({ nodes: { ...nodes } })
    updateWallTreatmentLevels()
    expect(spy).not.toHaveBeenCalled()
    const wall = { ...walls[0]!, supportOffset: 0.1 }
    useScene.setState({ nodes: { ...nodes, [wall.id]: wall } })
    updateWallTreatmentLevels()
    expect(spy).toHaveBeenCalledTimes(1)
  } finally {
    spy.mockRestore()
    useLiveTransforms.getState().clearAll()
  }
})

test('floor-length windows expose plate steps and invalidate plate partitions', async () => {
  const { WindowNode, computePlateSurfacePartition, classifyPlateSideAt, plateLevelContext } =
    await import('@pascal-app/core')
  const { divider, nodes, door, slabs, level } = floorStepFixture()
  const window = WindowNode.parse({
    ...door,
    id: 'window_step',
    type: 'window',
    openingKind: 'window',
  })
  const withWindow = {
    ...nodes,
    [divider.id]: { ...divider, children: [window.id] },
    [window.id]: window,
  }
  const tracker = createSlabDependencyTracker(withWindow)
  const context = plateLevelContext(level, (id) => withWindow[id])
  const before = computePlateSurfacePartition(slabs[0]!, context)!
  expect(classifyPlateSideAt(before, [4.1, 2])).toBe('riser')
  const moved = {
    ...withWindow,
    [window.id]: { ...window, position: [3, 1, 0] as [number, number, number] },
  }
  expect(tracker(moved).sort()).toEqual(slabs.map((slab) => slab.id).sort())
  expect(
    computePlateSurfacePartition(
      slabs[0]!,
      plateLevelContext(level, (id) => moved[id]),
    ),
  ).not.toBe(before)
})

test('low-side skirting stops at floor-length windows and continues below high sills', async () => {
  const { WindowNode } = await import('@pascal-app/core')
  const { divider, walls, slabs, nodes, door } = floorStepFixture()
  useScene.setState({ nodes })
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  const window = WindowNode.parse({
    ...door,
    id: 'window_step',
    type: 'window',
    openingKind: 'window',
  })
  for (const [opening, faceDatum, continuous] of [
    [window, support.faceDatum, false],
    [
      { ...door, position: [2, 2, 0] as [number, number, number] },
      { a: support.faceDatum.b, b: support.faceDatum.b },
      true,
    ],
  ] as const) {
    const data = buildWallTreatmentLevelData(
      'level_step',
      walls,
      wallTreatmentProudOffsets(divider),
      new Map([[divider.id, { ...support, faceDatum }]]),
    )
    const geometry = buildTrimGeometry(divider, 'b', trim, 'skirting', [opening], data)!
    // An uninterrupted run has triangles spanning the opening's center station.
    const positions = geometry.getAttribute('position')
    let crosses = false
    for (let i = 0; i < positions.count; i += 3) {
      const xs = [positions.getX(i), positions.getX(i + 1), positions.getX(i + 2)]
      if (Math.min(...xs) < 2 && Math.max(...xs) > 2) crosses = true
    }
    expect(crosses).toBe(continuous)
    geometry.dispose()
  }
})
