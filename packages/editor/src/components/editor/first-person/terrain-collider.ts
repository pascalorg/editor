/**
 * The sculpted ground as walkthrough collision geometry.
 *
 * The first-person collider world is a single merged BVH mesh, and before terrain
 * the ground contributed one flat 2 km box to it. That box is wrong in both
 * directions on a sculpted site: it holds the player up at the datum inside an
 * excavation, and buries them inside a hill. This module replaces it.
 *
 * Two properties it has to hold, because the whole point is that walking agrees
 * with every other consumer of the field:
 *
 * - **The surface is the field**, sampled at every vertex — the same
 *   `heightAtSample`/`normalAt` the rendered mesh uses (`terrain-geometry.ts`),
 *   so what you see is what you stand on. It is deliberately not a decimated
 *   proxy at realistic field sizes.
 * - **It extends past the field**, because `heightAt` clamps to the border
 *   outside it. A collider that stopped at the field edge would drop the player
 *   into the void one step past the site, which is exactly the bug the flat box
 *   existed to prevent. The skirt extrudes each border sample outward at its own
 *   height, so the collider and `heightAt` agree everywhere, not just inside.
 *
 * Non-indexed triangles with position + normal, matching what the other collider
 * contributors emit — `mergeGeometries` requires every input to agree on both.
 */

import { heightAtSample, normalAt, type TerrainField } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * How far past the field the ground keeps holding the player, in metres. Matches
 * the flat box's half-extent so a site's collider bounds do not change size when
 * it gains terrain.
 */
const SKIRT_REACH = 1000

/**
 * Cell budget before the collider decimates.
 *
 * 66k cells is a 257² field — the largest anything realistic produces, and ~131k
 * triangles, which the BVH builds in well under a frame's worth of budget. The
 * schema allows up to 4097² (a decode-bomb guard, not a real terrain); at that
 * size an exact collider would be 100M triangles, so past the budget this steps
 * the sample grid and the collider becomes a faithful-but-coarser version of the
 * same surface rather than an out-of-memory crash.
 */
const MAX_COLLIDER_CELLS = 66_000

function colliderStride(field: TerrainField): number {
  const cells = Math.max(1, (field.cols - 1) * (field.rows - 1))
  if (cells <= MAX_COLLIDER_CELLS) return 1
  return Math.ceil(Math.sqrt(cells / MAX_COLLIDER_CELLS))
}

/** The sample indices the collider walks: every `stride`-th, always including the border. */
function sampleLine(count: number, stride: number): number[] {
  const line: number[] = []
  for (let i = 0; i < count - 1; i += stride) line.push(i)
  line.push(count - 1)
  return line
}

type Vertex = { x: number; y: number; z: number }

class TriangleSink {
  private readonly positions: number[] = []
  private readonly normals: number[] = []

  constructor(private readonly field: TerrainField) {}

  private push(v: Vertex): void {
    this.positions.push(v.x, v.y, v.z)
    const [nx, ny, nz] = normalAt(this.field, v.x, v.z)
    this.normals.push(nx, ny, nz)
  }

  /**
   * One cell, given its four corners named by axis order. Winding matches
   * `buildTerrainMesh`: `(p00, p01, p10)` and `(p10, p01, p11)` faces +Y, which is
   * what the spawn resolver's `normal.dot(UP) > 0.2` floor test needs.
   */
  quad(p00: Vertex, p10: Vertex, p01: Vertex, p11: Vertex): void {
    this.push(p00)
    this.push(p01)
    this.push(p10)
    this.push(p10)
    this.push(p01)
    this.push(p11)
  }

  build(): THREE.BufferGeometry | null {
    if (this.positions.length === 0) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.positions), 3),
    )
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normals), 3))
    return geometry
  }
}

/**
 * Terrain collision geometry in the site's own frame — the caller applies the
 * site's world matrix, exactly as it did for the flat box it replaces.
 */
export function createTerrainColliderGeometry(field: TerrainField): THREE.BufferGeometry | null {
  if (field.cols < 2 || field.rows < 2) return null

  const stride = colliderStride(field)
  const cols = sampleLine(field.cols, stride)
  const rows = sampleLine(field.rows, stride)
  const sink = new TriangleSink(field)

  const xAt = (col: number) => field.origin[0] + col * field.spacing
  const zAt = (row: number) => field.origin[1] + row * field.spacing
  const at = (col: number, row: number): Vertex => ({
    x: xAt(col),
    y: heightAtSample(field, col, row),
    z: zAt(row),
  })

  for (let ri = 0; ri < rows.length - 1; ri++) {
    const r0 = rows[ri] as number
    const r1 = rows[ri + 1] as number
    for (let ci = 0; ci < cols.length - 1; ci++) {
      const c0 = cols[ci] as number
      const c1 = cols[ci + 1] as number
      sink.quad(at(c0, r0), at(c1, r0), at(c0, r1), at(c1, r1))
    }
  }

  // The skirt: each border sample extruded outward at its own height, so stepping
  // off the field lands on the border height rather than on nothing. This is the
  // collider spelling of `heightAt`'s edge clamp.
  const firstCol = 0
  const lastCol = field.cols - 1
  const firstRow = 0
  const lastRow = field.rows - 1
  const westX = xAt(firstCol) - SKIRT_REACH
  const eastX = xAt(lastCol) + SKIRT_REACH
  const northZ = zAt(firstRow) - SKIRT_REACH
  const southZ = zAt(lastRow) + SKIRT_REACH

  for (let ci = 0; ci < cols.length - 1; ci++) {
    const c0 = cols[ci] as number
    const c1 = cols[ci + 1] as number
    const north0 = at(c0, firstRow)
    const north1 = at(c1, firstRow)
    sink.quad(
      { x: north0.x, y: north0.y, z: northZ },
      { x: north1.x, y: north1.y, z: northZ },
      north0,
      north1,
    )
    const south0 = at(c0, lastRow)
    const south1 = at(c1, lastRow)
    sink.quad(
      south0,
      south1,
      { x: south0.x, y: south0.y, z: southZ },
      {
        x: south1.x,
        y: south1.y,
        z: southZ,
      },
    )
  }

  for (let ri = 0; ri < rows.length - 1; ri++) {
    const r0 = rows[ri] as number
    const r1 = rows[ri + 1] as number
    const west0 = at(firstCol, r0)
    const west1 = at(firstCol, r1)
    sink.quad(
      { x: westX, y: west0.y, z: west0.z },
      west0,
      { x: westX, y: west1.y, z: west1.z },
      west1,
    )
    const east0 = at(lastCol, r0)
    const east1 = at(lastCol, r1)
    sink.quad(east0, { x: eastX, y: east0.y, z: east0.z }, east1, {
      x: eastX,
      y: east1.y,
      z: east1.z,
    })
  }

  // Corner quads, flat at the corner sample's height — the diagonal region no edge
  // strip covers, and where `heightAt` also reports the corner value.
  const corners: Array<[Vertex, number, number]> = [
    [at(firstCol, firstRow), westX, northZ],
    [at(lastCol, firstRow), eastX, northZ],
    [at(firstCol, lastRow), westX, southZ],
    [at(lastCol, lastRow), eastX, southZ],
  ]
  for (const [corner, farX, farZ] of corners) {
    const minX = Math.min(corner.x, farX)
    const maxX = Math.max(corner.x, farX)
    const minZ = Math.min(corner.z, farZ)
    const maxZ = Math.max(corner.z, farZ)
    const y = corner.y
    sink.quad(
      { x: minX, y, z: minZ },
      { x: maxX, y, z: minZ },
      { x: minX, y, z: maxZ },
      { x: maxX, y, z: maxZ },
    )
  }

  return sink.build()
}
