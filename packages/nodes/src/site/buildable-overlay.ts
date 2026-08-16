/**
 * The setback strip as a mesh laid on the ground.
 *
 * The strip is the parcel with the buildable rings punched out of it: the land
 * the setbacks put off limits. It is presentation only — derived from the site
 * node every frame it changes, never stored, and marked `pascalExport: 'strip'`
 * by its renderer so exports and framing ignore it.
 *
 * On sculpted ground the outline is subdivided at the terrain's own creases
 * before triangulation, the same trick `terrain-drape` uses for the lot line.
 * That puts a vertex wherever the surface bends along the strip's boundary, so
 * the triangles between them span at most the width of the strip — a few metres
 * — and the tint follows the hill instead of slicing through it. It is not the
 * exactness the polyline gets: a triangle's interior still cuts a chord across
 * whatever the ground does inside it. For a translucent band under a draped
 * boundary line that is the right trade; going further means a constrained
 * triangulation against the grid.
 */

import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, Path, Shape, ShapeGeometry } from 'three'
import { creaseCrossings } from './terrain-drape'

type Ring = ReadonlyArray<readonly [number, number]>

/** Ring points plus a vertex at every crease the ring's edges cross. */
export function subdivideRingAgainstTerrain(
  points: Ring,
  field: TerrainField | null,
): Array<[number, number]> {
  if (!field) return points.map(([x, z]) => [x, z] as [number, number])

  const subdivided: Array<[number, number]> = []
  for (let index = 0; index < points.length; index++) {
    const from = points[index]!
    const to = points[(index + 1) % points.length]!
    subdivided.push([from[0], from[1]])
    for (const t of creaseCrossings(field, from[0], from[1], to[0], to[1])) {
      subdivided.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
    }
  }
  return subdivided
}

/**
 * Triangulates the strip in world XZ, with Y sampled off the terrain.
 *
 * `ShapeGeometry` works in XY and the caller would normally rotate the mesh
 * onto the ground plane. Here the vertices carry their own heights, so the
 * buffer is rewritten into world space directly and the mesh needs no rotation —
 * a rotated mesh could not have per-vertex ground heights at all.
 */
export function buildSetbackStripGeometry({
  parcel,
  buildableRings,
  field,
  lift,
}: {
  parcel: Ring
  buildableRings: readonly Ring[]
  field: TerrainField | null
  lift: number
}): BufferGeometry | null {
  if (parcel.length < 3) return null

  const outline = subdivideRingAgainstTerrain(parcel, field)
  const shape = new Shape()
  shape.moveTo(outline[0]![0], -outline[0]![1])
  for (let index = 1; index < outline.length; index++) {
    shape.lineTo(outline[index]![0], -outline[index]![1])
  }
  shape.closePath()

  for (const ring of buildableRings) {
    if (ring.length < 3) continue
    const hole = new Path()
    const holeOutline = subdivideRingAgainstTerrain(ring, field)
    hole.moveTo(holeOutline[0]![0], -holeOutline[0]![1])
    for (let index = 1; index < holeOutline.length; index++) {
      hole.lineTo(holeOutline[index]![0], -holeOutline[index]![1])
    }
    hole.closePath()
    shape.holes.push(hole)
  }

  const flat = new ShapeGeometry(shape)
  const source = flat.getAttribute('position')
  const positions = new Float32Array(source.count * 3)
  for (let index = 0; index < source.count; index++) {
    const x = source.getX(index)
    const z = -source.getY(index)
    positions[index * 3] = x
    positions[index * 3 + 1] = (field ? surfaceHeightAt(field, x, z) : 0) + lift
    positions[index * 3 + 2] = z
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const index = flat.getIndex()
  if (index) geometry.setIndex(Array.from(index.array))
  geometry.computeVertexNormals()
  flat.dispose()
  return geometry
}
