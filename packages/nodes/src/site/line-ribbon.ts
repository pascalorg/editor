/**
 * A patterned RIBBON along a draped polyline — the way a property line or a
 * setback line is drawn on the ground in 3D. WebGL ignores line widths, so
 * a thick line is a flat mesh: the polyline (already draped on the terrain
 * by `buildDrapedPolyline`) is walked by arc length, the on / off pattern
 * is unrolled along it (metres: dash, gap, dot, gap, dot, gap — the
 * standard property line; dash, gap — a setback), and every "on" run
 * becomes quads `width` wide lying flat in the XZ plane at the draped
 * height. Pure; the renderer wraps the geometry in a mesh.
 *
 * Steve (2026-09-07): "i want the property line to be dark and thick like
 * line then two dots dashed like standard property line, and the setbacks
 * … black and dashed".
 */
import { surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry } from 'three'

/** The standard property line: a long dash, two dots (metres). */
export const PROPERTY_LINE_PATTERN: readonly number[] = [3.0, 0.6, 0.35, 0.6, 0.35, 0.6]
/** A setback line: dashed. */
export const SETBACK_LINE_PATTERN: readonly number[] = [1.2, 0.6]

type V3 = [number, number, number]

/** The draped polyline's vertices, xyz per vertex. */
function vertexAt(positions: Float32Array, i: number): V3 {
  return [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0]
}

/** Point at arc length `s` along the polyline (plan length), with the local XZ direction. */
function sample(positions: Float32Array, cum: number[], s: number): { p: V3; d: [number, number] } {
  const count = cum.length
  let i = 0
  while (i + 1 < count - 1 && (cum[i + 1] as number) < s) i++
  const a = vertexAt(positions, i)
  const b = vertexAt(positions, Math.min(count - 1, i + 1))
  const seg = (cum[i + 1] as number) - (cum[i] as number)
  const t = seg > 1e-9 ? Math.max(0, Math.min(1, (s - (cum[i] as number)) / seg)) : 0
  const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const len = Math.hypot(dx, dz) || 1
  return { p, d: [dx / len, dz / len] }
}

/**
 * Re-drape a ribbon on a changed field: every vertex keeps its XZ and takes
 * the ground's height there plus `lift` (a sculpt stroke mid-flight).
 */
export function updateRibbonHeights(geometry: BufferGeometry, field: TerrainField | null, lift: number): void {
  const attribute = geometry.getAttribute('position') as BufferAttribute | undefined
  if (!attribute) return
  const array = attribute.array as Float32Array
  for (let i = 0; i < attribute.count; i++) {
    const x = array[i * 3] ?? 0
    const z = array[i * 3 + 2] ?? 0
    array[i * 3 + 1] = field ? surfaceHeightAt(field, x, z) + lift : lift
  }
  attribute.needsUpdate = true
  geometry.computeBoundingSphere()
}

/**
 * Build the ribbon. `positions` is the draped polyline (xyz per vertex,
 * consecutive, NOT closed — pass the closing vertex yourself); `pattern`
 * alternates on / off lengths in metres; `width` is the ribbon's full width.
 */
export function buildPatternedRibbon(
  positions: Float32Array,
  pattern: readonly number[],
  width: number,
  step = 0.25,
): BufferGeometry {
  const count = Math.floor(positions.length / 3)
  const geometry = new BufferGeometry()
  if (count < 2 || pattern.length < 2) return geometry
  // cumulative PLAN arc length per vertex
  const cum: number[] = [0]
  for (let i = 1; i < count; i++) {
    const a = vertexAt(positions, i - 1)
    const b = vertexAt(positions, i)
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[2] - a[2]))
  }
  const total = cum[count - 1] as number
  if (total < 1e-6) return geometry
  const period = pattern.reduce((s, v) => s + v, 0)
  if (period <= 0) return geometry
  const verts: number[] = []
  const index: number[] = []
  const half = width / 2
  // walk the pattern along the line; each "on" run is a strip of quads
  let s = 0
  let k = 0
  while (s < total) {
    const len = pattern[k % pattern.length] as number
    const on = k % 2 === 0
    const s0 = s
    const s1 = Math.min(total, s + len)
    if (on && s1 - s0 > 1e-6) {
      // subdivide the run so it follows corners and the drape
      const n = Math.max(1, Math.ceil((s1 - s0) / step))
      const base = verts.length / 3
      for (let j = 0; j <= n; j++) {
        const { p, d } = sample(positions, cum, s0 + ((s1 - s0) * j) / n)
        // the ribbon's normal in plan is the line direction turned 90°
        const nx = -d[1] * half
        const nz = d[0] * half
        verts.push(p[0] + nx, p[1], p[2] + nz, p[0] - nx, p[1], p[2] - nz)
      }
      for (let j = 0; j < n; j++) {
        const a = base + j * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    s = s1
    k++
    if (k > 100000) break
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
