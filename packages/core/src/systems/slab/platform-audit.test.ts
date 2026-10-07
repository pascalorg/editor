import { expect, test } from 'bun:test'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import {
  initSpatialGridSync,
  markTerrainSupportDependents,
} from '../../hooks/spatial-grid/spatial-grid-sync'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField } from '../../lib/terrain-field'
import { levelBaseElevationAt, noteLevelBaseConsumer } from '../../lib/terrain-support'
import { nodeLevelFrame } from '../../procedural-items/query'
import { WallNode } from '../../schema'
import useLiveTerrain from '../../store/use-live-terrain'
import useScene from '../../store/use-scene'
import { raisedRoomFixture } from './__fixtures__/raised-room'
import { computeWallSlabSupport } from './slab-support'

for (const elevation of [0.05, 0.6])
  test(`terrain dirties only platform plates and adjacent walls: floor=${elevation}`, () => {
    const fixture = raisedRoomFixture()
    const slabs = fixture.slabs.map((slab) => ({ ...slab, elevation }))
    const remote = WallNode.parse({
      id: 'wall_remote',
      parentId: fixture.level.id,
      start: [20, 0],
      end: [25, 0],
    })
    const nodes = {
      ...fixture.nodes,
      [remote.id]: remote,
      ...Object.fromEntries(slabs.map((slab) => [slab.id, slab])),
    }
    noteLevelBaseConsumer('slab')
    const dirty = new Set<string>()
    markTerrainSupportDependents(nodes, (id) => dirty.add(id))
    expect([...dirty].sort()).toEqual(
      elevation > 0.05 ? [...fixture.walls.map((wall) => wall.id), slabs[0]!.id].sort() : [],
    )
  })

test('flush plate and face support stays cached and above a terrain depression', () => {
  const fixture = raisedRoomFixture()
  const slab = { ...fixture.slabs[0]!, elevation: 0.05 }
  const field = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
  field.heights.fill(-40)
  const nodes = {
    ...fixture.nodes,
    [slab.id]: slab,
    [fixture.site.id]: { ...fixture.site, terrain: encodeTerrainField(field) },
  }
  const original = useScene.getState()
  useScene.setState({ nodes, dirtyNodes: new Set() })
  spatialGridManager.clear()
  const stop = initSpatialGridSync()
  const wall = fixture.walls[0]!
  const support = () =>
    spatialGridManager.getSlabSupportForWall(
      fixture.level.id,
      wall.start,
      wall.end,
      0,
      wall.thickness,
    )
  try {
    const before = support()
    expect(before.faceDatum.a).toEqual([{ start: 0, end: 1, elevation: 0.05 }])
    expect(before.faceDatum.b).toEqual(before.faceDatum.a)
    useScene.setState({ dirtyNodes: new Set() })
    // Change terrain away from this wall's election anchor.
    const changed = { ...field, heights: field.heights.slice() }
    changed.heights[30] = -50
    useLiveTerrain.getState().begin(fixture.site.id, changed)
    expect(useScene.getState().dirtyNodes.size).toBe(0)
    expect(support()).toBe(before)
  } finally {
    stop()
    useLiveTerrain.getState().end(fixture.site.id)
    spatialGridManager.clear()
    useScene.setState(original)
  }
})

test('sunken exterior faces use the ground profile on a sculpted site', () => {
  const { nodes, slabs, walls } = raisedRoomFixture(false, true)
  const sunken = slabs.map((slab) => ({ ...slab, elevation: -0.4 }))
  const support = computeWallSlabSupport(walls[0]!, sunken, walls, undefined, undefined, 0, nodes)
  expect(support.faceDatum.a).toEqual([{ start: 0, end: 1, elevation: -0.4 }])
  expect(support.faceDatum.b).toEqual([{ start: 0, end: 1, elevation: 0.12, endElevation: 0.28 }])
})

test('procedural spatial queries use the supplied snapshot rather than a live terrain stroke', () => {
  const fixture = raisedRoomFixture(false, true)
  const wall = fixture.walls[0]!
  const nodes = Object.fromEntries(
    Object.entries(fixture.nodes).filter(([, node]) => node.type !== 'slab'),
  )
  const before = nodeLevelFrame(wall.id, nodes)
  const live = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
  live.heights.fill(80)
  try {
    useLiveTerrain.getState().begin(fixture.site.id, live)
    expect(levelBaseElevationAt(nodes, fixture.level.id, 0, 0)).toBe(0.8)
    expect(nodeLevelFrame(wall.id, nodes)).toEqual(before)
    expect(before.position[1]).toBeCloseTo(0.12)
  } finally {
    useLiveTerrain.getState().end(fixture.site.id)
  }
})
