import type { BoxGeometry } from 'three'

/**
 * Rewrite a default `BoxGeometry`'s UVs to world scale — 1 UV unit = 1 metre —
 * so tiled finishes (with `repeat` in tiles-per-metre) render at a consistent
 * real-world scale instead of stretching to fit each face. Matches the
 * world-scale UV convention used by the procedural slab/wall geometry.
 *
 * three.js builds box faces in the fixed order [+X, -X, +Y, -Y, +Z, -Z], four
 * verts each, with UVs spanning 0→1 across the face. Each face's two in-plane
 * dimensions differ, so we scale U/V per face by that face's size in metres.
 */
export function applyWorldScaleBoxUVs(
  geometry: BoxGeometry,
  w: number,
  h: number,
  d: number,
): void {
  const uv = geometry.getAttribute('uv')
  if (!uv || uv.count < 24) return // non-default segmentation — leave as-is

  // [uScaleMetres, vScaleMetres] per face, in three's face order.
  const faceScale: Array<[number, number]> = [
    [d, h], // +X
    [d, h], // -X
    [w, d], // +Y
    [w, d], // -Y
    [w, h], // +Z
    [w, h], // -Z
  ]

  for (let face = 0; face < 6; face += 1) {
    const [us, vs] = faceScale[face]!
    for (let v = 0; v < 4; v += 1) {
      const i = face * 4 + v
      uv.setXY(i, uv.getX(i) * us, uv.getY(i) * vs)
    }
  }
  uv.needsUpdate = true
}
