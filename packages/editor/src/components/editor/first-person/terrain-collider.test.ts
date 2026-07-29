import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  flattenPatch,
  heightAt,
  type TerrainField,
} from '@pascal-app/core'
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { createTerrainColliderGeometry } from './terrain-collider'

const DOWN = new Vector3(0, -1, 0)
const UP = new Vector3(0, 1, 0)

/** A 2.5 m plateau over x,z ∈ [2,5] on an otherwise flat field. */
function plateauField(): TerrainField {
  const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 2.5)
  return applyHeightPatch(base, patch as never)
}

/** A field sloping 0.1 m per metre along +x, so every sample differs. */
function slopedField(): TerrainField {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, origin: [-4, -4] })
  const heights = new Int16Array(field.heights)
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      heights[r * field.cols + c] = Math.round((c * 0.1) /* m */ / field.step)
    }
  }
  return { ...field, heights }
}

function colliderMesh(field: TerrainField) {
  const geometry = createTerrainColliderGeometry(field)
  if (!geometry) throw new Error('no collider geometry')
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.updateMatrixWorld(true)
  return mesh
}

/** The height a downward ray finds — what the walkthrough player stands on. */
function groundUnder(mesh: Mesh, x: number, z: number): number | null {
  const raycaster = new Raycaster()
  raycaster.set(new Vector3(x, 500, z), DOWN)
  const hits = raycaster.intersectObject(mesh, false)
  const floor = hits.find((hit) => {
    if (!hit.face) return true
    return hit.face.normal.clone().transformDirection(mesh.matrixWorld).dot(UP) > 0.2
  })
  return floor ? floor.point.y : null
}

describe('createTerrainColliderGeometry', () => {
  test('the walkable surface is the field, not a plane', () => {
    const field = plateauField()
    const mesh = colliderMesh(field)

    // On the plateau, off it, and on the slope between: the collider has to agree
    // with `heightAt` at each, or what you see is not what you stand on.
    for (const [x, z] of [
      [3, 3],
      [-3, -3],
      [1.5, 3],
      [4.5, 4.5],
    ] as Array<[number, number]>) {
      expect(groundUnder(mesh, x, z)).toBeCloseTo(heightAt(field, x, z), 4)
    }
  })

  test('a sloped field is sampled per vertex, not averaged', () => {
    const field = slopedField()
    const mesh = colliderMesh(field)

    // Sample midpoints, where a flat or decimated collider would disagree most.
    for (const x of [-3.5, -0.5, 1.5, 3.5]) {
      expect(groundUnder(mesh, x, 0)).toBeCloseTo(heightAt(field, x, 0), 4)
    }
  })

  test('the skirt keeps holding the player far past the field', () => {
    const field = slopedField()
    const mesh = colliderMesh(field)

    // Past every edge and past a corner: `heightAt` clamps to the border there, so
    // the collider must too. Without the skirt these are null and the player falls.
    for (const [x, z] of [
      [400, 0],
      [-400, 0],
      [0, 400],
      [0, -400],
      [400, 400],
      [-400, -400],
    ] as Array<[number, number]>) {
      expect(groundUnder(mesh, x, z)).toBeCloseTo(heightAt(field, x, z), 4)
    }
  })

  test('every triangle carries a normal, and the surface faces up', () => {
    const geometry = createTerrainColliderGeometry(plateauField())
    if (!geometry) throw new Error('no collider geometry')

    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    expect(normal).toBeDefined()
    expect(normal.count).toBe(position.count)
    // Non-indexed triangles — `mergeGeometries` needs every contributor to match.
    expect(geometry.index).toBeNull()
    expect(position.count % 3).toBe(0)

    for (let i = 0; i < normal.count; i++) {
      expect(normal.getY(i)).toBeGreaterThan(0)
    }
  })

  test('decimates rather than exploding on an absurd field', () => {
    // 1025² is inside the schema's decode-bomb guard but 1M cells — an exact
    // collider would be 2M triangles for a surface nobody can walk that far across.
    const field = createTerrainField({ cols: 1025, rows: 1025, spacing: 0.5 })
    const geometry = createTerrainColliderGeometry(field)
    if (!geometry) throw new Error('no collider geometry')

    const triangles = geometry.getAttribute('position').count / 3
    expect(triangles).toBeLessThan(200_000)
    // Still a real surface, not an empty one.
    expect(triangles).toBeGreaterThan(1000)
  })

  test('returns null for a degenerate field', () => {
    expect(createTerrainColliderGeometry(createTerrainField({ cols: 1, rows: 1 }))).toBeNull()
  })
})
