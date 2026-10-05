import { expect, test } from 'bun:test'
import {
  createTerrainField,
  initSpatialGridSync,
  spatialGridManager,
  useLiveTerrain,
  useScene,
  type WallTrimConfig,
} from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { raisedRoomFixture } from '../../../core/src/systems/slab/__fixtures__/raised-room'
import { resetWallTreatmentLevels, updateWallTreatmentLevels } from './system'
import { useWallTreatmentLevelData } from './treatment-level-data'
import { buildTrimGeometry } from './treatments'

test('platform skirting follows each face and refreshes with terrain strokes and cancellation', () => {
  const fixture = raisedRoomFixture(false, true)
  const original = useScene.getState()
  const trim: WallTrimConfig = {
    enabled: true,
    height: 0.1,
    proud: 0.02,
    profile: 'flat',
    sides: 'both',
  }
  const wall = { ...fixture.walls[0]!, skirting: trim }
  useScene.setState({
    nodes: { ...fixture.nodes, [wall.id]: wall },
    dirtyNodes: new Set([wall.id]),
  })
  spatialGridManager.clear()
  resetWallTreatmentLevels()
  const stop = initSpatialGridSync()
  const check = (baseAt: (x: number) => number) => {
    updateWallTreatmentLevels()
    const data = useWallTreatmentLevelData.getState().byLevelId.get(fixture.level.id)!
    const support = data.supports!.get(wall.id)!
    expect(support.elevation).toBe(0.6)
    for (const side of ['a', 'b'] as const) {
      const geometry = buildTrimGeometry(wall, side, trim, 'skirting', [], data)!
      const material = new MeshBasicMaterial({ side: DoubleSide })
      const mesh = new Mesh(geometry, material)
      mesh.position.y = support.elevation
      mesh.updateMatrixWorld(true)
      for (const x of [1, 3, 7]) {
        const ray = new Raycaster(
          new Vector3(x, -1, side === 'a' ? 0.105 : -0.105),
          new Vector3(0, 1, 0),
        )
        expect(ray.intersectObject(mesh)[0]!.point.y).toBeCloseTo(side === 'a' ? 0.6 : baseAt(x), 5)
      }
      geometry.dispose()
      material.dispose()
    }
  }
  try {
    check((x) => 0.12 + 0.02 * x)
    useScene.setState({ dirtyNodes: new Set() })
    const field = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
    field.heights.fill(30)
    useLiveTerrain.getState().begin(fixture.site.id, field)
    expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(fixture.slabs[0]!.id)).toBe(true)
    check(() => 0.3)
    useLiveTerrain.getState().end(fixture.site.id)
    check((x) => 0.12 + 0.02 * x)
  } finally {
    stop()
    useLiveTerrain.getState().end(fixture.site.id)
    resetWallTreatmentLevels()
    spatialGridManager.clear()
    useScene.setState(original)
  }
})
