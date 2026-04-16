import * as THREE from 'three'

/**
 * Compute the dominant edge orientation of a polygon in the XZ plane,
 * in radians, folded into [0, π/2).
 *
 * Why: scanned houses (RoomPlan) rarely come in axis-aligned with world
 * XZ — the building envelope is rotated by whatever yaw the scanner had.
 * `THREE.ExtrudeGeometry` and `THREE.ShapeGeometry` auto-generate UVs
 * from the shape's local (x, y), which for slab/ceiling polygons are
 * literally world X and Z. Rotated house → diagonal texture pattern.
 *
 * The fix: project UVs into a frame rotated by this angle so the U axis
 * lines up with the dominant wall direction. Directions 90° apart are
 * equivalent for a rectangular layout, which is why we fold mod π/2.
 *
 * Algorithm: length-weighted histogram of edge angles (1° bins over
 * [0, π/2)), return the modal bin's midpoint. Length weighting means
 * short jagged edges (typical of scan noise) don't overwhelm the two
 * or three long walls that actually define the house's orientation.
 */
export function dominantPolygonAngle(polygon: Array<[number, number]>): number {
  const BINS = 90
  const bins = new Array<number>(BINS).fill(0)
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    let angle = Math.atan2(dz, dx)
    // Fold into [0, π/2) so 0°/90°/180°/270° are equivalent.
    angle = ((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
    const bin = Math.min(Math.floor((angle / (Math.PI / 2)) * BINS), BINS - 1)
    bins[bin]! += len
  }
  let maxBin = 0
  for (let i = 1; i < BINS; i++) {
    if (bins[i]! > bins[maxBin]!) maxBin = i
  }
  return (maxBin / BINS) * (Math.PI / 2)
}

/**
 * Override geometry UVs with a world-XZ projection rotated by `-angle`.
 * Call after any `rotateX` so `position.getX/getZ` reflect final world
 * coordinates. UVs are in metres (one UV unit = one world metre), so
 * texture `repeat` values act as "tiles per metre".
 *
 * Side faces of extruded slabs (the 5cm-thick edge ring) get degenerate
 * UVs from this projection, but they're effectively invisible from any
 * realistic camera angle.
 */
export function setAxisAlignedPlanarUVs(
  geometry: THREE.BufferGeometry,
  angle: number,
): void {
  const positionAttr = geometry.attributes.position
  if (!positionAttr) return
  const count = positionAttr.count
  const uvs = new Float32Array(count * 2)
  const c = Math.cos(-angle)
  const s = Math.sin(-angle)
  for (let i = 0; i < count; i++) {
    const x = positionAttr.getX(i)
    const z = positionAttr.getZ(i)
    uvs[i * 2] = x * c - z * s
    uvs[i * 2 + 1] = x * s + z * c
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}
