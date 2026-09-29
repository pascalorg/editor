import { expect, test } from 'bun:test'
import { levelBaseElevationAt } from '../../lib/terrain-support-query'
import { getWallCurveFrameAt } from '../wall/wall-curve'
import { getWallFaceOffsets } from '../wall/wall-frame'
import { resolveWallTop } from '../wall/wall-top'
import { raisedRoomFixture } from './__fixtures__/raised-room'
import { computeWallSlabSupport } from './slab-support'

test('raised room has a 0.6 inner face and a grounded outer face without changing hosted support', () => {
  const { walls, slabs, nodes } = raisedRoomFixture()
  for (const wall of walls) {
    const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
    expect(support.faceDatum).toEqual({
      a: [{ start: 0, end: 1, elevation: 0.6 }],
      b: [{ start: 0, end: 1, elevation: 0 }],
    })
    expect(support.elevation).toBe(0.6)
    expect(support.baseSegments).toEqual([{ start: 0, end: 1, elevation: 0.6 }])
    expect(resolveWallTop(wall, 3, support.elevation)).toBe(3)
    expect(resolveWallTop({ ...wall, height: 2.5 }, 3, support.elevation)).toBe(3.1)
  }
})

test('raised and ground rooms keep independent 0.6 and 0.05 shared-wall faces', () => {
  const { divider, walls, slabs, nodes } = raisedRoomFixture(true)
  const support = computeWallSlabSupport(divider, slabs, walls, undefined, undefined, 0, nodes)
  expect(support.faceDatum).toEqual({
    a: [{ start: 0, end: 1, elevation: 0.6 }],
    b: [{ start: 0, end: 1, elevation: 0.05 }],
  })
})

test('raised room exterior faces sample terrain independently of the room floor', () => {
  const { walls, slabs, nodes, level } = raisedRoomFixture(false, true)
  for (const wall of walls) {
    const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
    for (const span of support.faceDatum.b)
      for (const t of [span.start, span.end]) {
        const frame = getWallCurveFrameAt(wall, t)
        const offset = getWallFaceOffsets(wall).b
        const ground = levelBaseElevationAt(
          nodes,
          level.id,
          frame.point.x + offset * frame.normal.x,
          frame.point.y + offset * frame.normal.y,
        )
        expect(
          t === span.start ? span.elevation : (span.endElevation ?? span.elevation),
        ).toBeCloseTo(ground)
      }
  }
})

test('setZoneIntent raises the reconciled floor without moving wall tops or exterior support', async () => {
  const { setZoneIntent } = await import('../../commands/structure/set-zone-intent')
  const { applyToScratch, structureChangeBatch } = await import('../../commands/structure/shared')
  const { reconcileSceneStructure } = await import('../../lib/structure-reconcile')
  const { spatialGridManager } = await import('../../hooks/spatial-grid/spatial-grid-manager')
  const { default: useScene } = await import('../../store/use-scene')
  const fixture = raisedRoomFixture()
  let sequence = 0
  const mintId = (kind: string) => `${kind}_platform_${sequence++}`
  const nodes = Object.fromEntries(
    Object.values(fixture.nodes).map((node) => [
      node.id,
      node.type === 'slab'
        ? { ...node, elevation: 0.05 }
        : node.type === 'zone'
          ? { ...node, floor: { elevation: 0.05 } }
          : node,
    ]),
  )
  const before = reconcileSceneStructure({ nodes, mintId }).nodes
  const zone = Object.values(before).find((node) => node.type === 'zone')!
  const plan = setZoneIntent(before, { zoneId: zone.id, patch: { floor: { elevation: 0.6 } } })
  const edited = applyToScratch(before, structureChangeBatch(plan.changes))
  const after = reconcileSceneStructure({ nodes: edited, previousNodes: before, mintId }).nodes
  const original = useScene.getState()
  useScene.setState({ nodes: after })
  spatialGridManager.clear()
  try {
    for (const node of Object.values(after))
      spatialGridManager.handleNodeCreated(node, fixture.level.id)
    const plate = Object.values(after).find(
      (node) => node.type === 'slab' && node.plateRole === 'platform',
    )!
    expect(plate.type === 'slab' && plate.elevation).toBe(0.6)
    expect(plate.type === 'slab' && plate.thickness).toBeCloseTo(0.55)
    for (const wall of fixture.walls) {
      expect(after[wall.id]).toEqual(before[wall.id])
      const support = spatialGridManager.getSlabSupportForWall(
        fixture.level.id,
        wall.start,
        wall.end,
        0,
        wall.thickness,
      )
      expect(support.elevation).toBe(0.05)
      expect(support.faceDatum.a).toEqual([{ start: 0, end: 1, elevation: 0.6 }])
      expect(support.faceDatum.b).toEqual([{ start: 0, end: 1, elevation: 0.05 }])
      expect(resolveWallTop(wall, 3, support.elevation)).toBe(3)
    }
    for (const node of Object.values(before))
      if (node.type === 'ceiling') expect(after[node.id]).toEqual(node)
  } finally {
    spatialGridManager.clear()
    useScene.setState(original)
  }
})
