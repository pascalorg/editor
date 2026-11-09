import { expect, test } from 'bun:test'
import { applyHeightPatch, createTerrainField, type Ring } from '@pascal-app/core'
import { Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { raisedRoomFixture } from '../../../core/src/systems/slab/__fixtures__/raised-room'
import { getRecessedSlabGroundHoles } from './recessed-slab-ground-holes'
import { applyTerrainPatch, createTerrainGeometry, disposeTerrainGeometry } from './terrain-mesh'

test('sunken automatic floors excavate the rendered footprint; flush plates do not', () => {
  const { nodes, slabs } = raisedRoomFixture()
  expect(getRecessedSlabGroundHoles(nodes)).toEqual([])
  nodes[slabs[0]!.id] = { ...slabs[0]!, elevation: -0.4 }
  expect(getRecessedSlabGroundHoles(nodes)).toEqual([slabs[0]!.polygon])
})

test('terrain cutouts expose sunken floors up to the exact rim and survive live sculpt patches', () => {
  let field = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
  const hole: Ring = [
    [0.1, 0.2],
    [7.9, 0.2],
    [7.9, 3.8],
    [0.1, 3.8],
  ]
  const target = createTerrainGeometry(field, [hole])
  const positions = target.buffers.positions
  const index = target.geometry.index
  const material = new MeshBasicMaterial()
  const group = new Group()
  group.add(new Mesh(target.geometry, material), new Mesh(target.holeBoundary!.geometry, material))
  group.updateMatrixWorld(true)
  try {
    for (const height of [0, 0.3]) {
      if (height) {
        const patch = {
          col0: 0,
          row0: 0,
          cols: field.cols,
          rows: field.rows,
          heights: new Int16Array(field.cols * field.rows).fill(30),
        }
        field = applyHeightPatch(field, patch)
        applyTerrainPatch(target, field, patch)
      }
      for (const x of [0.09, 0.11, 2, 7.89, 7.91]) {
        const ray = new Raycaster(new Vector3(x, 2, 1.3), new Vector3(0, -1, 0))
        const hits = ray.intersectObject(group)
        if (x > 0.1 && x < 7.9) expect(hits).toHaveLength(0)
        else expect(hits[0]!.point.y).toBeCloseTo(height)
      }
      expect(target.buffers.positions).toBe(positions)
      expect(target.geometry.index).toBe(index)
    }
  } finally {
    disposeTerrainGeometry(target)
    material.dispose()
  }
})
