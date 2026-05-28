import type { GutterNode } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Pure builder for the gutter mesh. The gutter is a hollow trough that
 * runs along the eave; we build its cross-section as a closed 2D Shape
 * in the (Z, Y) plane with the channel cavity carved out as a Path
 * hole, then extrude along the gutter's local +X (length direction).
 *
 * Three profiles share the same outer-outline-minus-cavity recipe; they
 * differ only in the OUTLINE shape:
 *
 *  - `k-style`:    flat back + flat bottom + ogee (S-curve) fascia.
 *                  Most common modern residential profile.
 *  - `half-round`: half-cylinder (semicircle cross-section).
 *  - `box`:        square / rectangular u-channel; reads as commercial.
 *
 * The gutter mounts at the eave line (gutter-local Y=0) and drops
 * downward (negative Y) by `size`. +Z is "away from the building" —
 * positive Z is the outer face that hangs over the eave.
 *
 * Pure: no React, no scene access, no store mutation.
 */
export function buildGutterGeometry(node: GutterNode): THREE.BufferGeometry {
  const len = Math.max(0.05, node.length)
  const size = Math.max(0.04, node.size)
  const t = Math.min(Math.max(0.001, node.thickness), size * 0.4)

  let cross: THREE.Shape
  if (node.profile === 'half-round') {
    cross = buildHalfRoundCross(size, t)
  } else if (node.profile === 'box') {
    cross = buildBoxCross(size, t)
  } else {
    cross = buildKStyleCross(size, t)
  }

  // Extrude the cross-section along the gutter's local +X. The Shapes
  // above are authored with cross-X going from 0 (outer rim) to +w
  // (back, against the fascia). After extrude (which produces mesh-X =
  // cross-X, mesh-Y = cross-Y, mesh-Z = extrusion axis = length), we
  // rotateY(-π/2) so the LENGTH lands along mesh-+X and the OUTWARD
  // direction lands along mesh-+Z (segment-local +Z is the downslope /
  // outward direction at the eave). The two-line combination is:
  //
  //   rotateY(-π/2): mesh-X (outward) → +Z, mesh-Z (length) → -X
  //   translate(+len/2, 0, 0):           recenter the now-negative
  //                                      length span around X = 0
  //
  // The renderer mounts this in segment-local frame with no extra
  // rotation, so the gutter naturally aligns with the eave when
  // `node.rotation = 0`.
  const extruded = new THREE.ExtrudeGeometry(cross, {
    depth: len,
    bevelEnabled: false,
    curveSegments: 16,
    steps: 1,
  })
  extruded.rotateY(-Math.PI / 2)
  extruded.translate(len / 2, 0, 0)
  extruded.computeVertexNormals()
  return extruded
}

// K-style cross-section in (X, Y) where X is the gutter's outward
// direction (positive = away from the wall) and Y is vertical (0 at
// eave line, -size at the bottom of the trough).
//
// Outer outline traces an ogee fascia:
//   top-back  (0, 0) →
//   bottom-back  (0, -size) →
//   bottom-front (w_bot, -size) →
//   front mid     (w_top, -size + size*0.35) — curve outward and up
//   top-front    (w_top, 0)
// then a hollow (the water channel) is carved as a Path hole offset by
// `t` from each face. Closing the top of the outer outline keeps the
// extrude solid; the lid disappears against the open channel because
// the hole runs through the entire extrusion.
function buildKStyleCross(size: number, t: number): THREE.Shape {
  const wBot = size * 0.8 // bottom width — narrower than the rim
  const wTop = size * 0.95
  const ogeeY = -size * 0.65 // S-curve inflection

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0, -size) // back, straight down
  shape.lineTo(wBot, -size) // bottom
  // Bezier the front fascia: bottom-front → ogee inflection → top-front.
  shape.bezierCurveTo(wBot + size * 0.15, ogeeY, wTop - size * 0.15, ogeeY * 0.4, wTop, 0)
  shape.closePath()

  // Inner hole, offset by `t` from the outer outline. Same shape with
  // walls pushed inward.
  const hole = new THREE.Path()
  hole.moveTo(t, -t)
  hole.lineTo(t, -size + t)
  hole.lineTo(wBot - t, -size + t)
  hole.bezierCurveTo(
    wBot + size * 0.15 - t,
    ogeeY,
    wTop - size * 0.15 - t,
    ogeeY * 0.4,
    wTop - t,
    -t,
  )
  hole.closePath()
  shape.holes.push(hole)
  return shape
}

// Half-round cross-section. The shape is approximated as a half-disc
// hanging below the eave line, with a thin lip pinned at Y=0 on each
// side so the gutter still reads as "mounted at the eave" rather than
// "floating below" it.
function buildHalfRoundCross(size: number, t: number): THREE.Shape {
  const r = size // radius == size: half-circle drops `size` below eave
  const segs = 24

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  // Trace the outer semicircle from (0, 0) down through (r, -r) back to (2r, 0).
  for (let i = 1; i <= segs; i++) {
    const angle = Math.PI + (Math.PI * i) / segs // π → 2π (lower half)
    shape.lineTo(r + r * Math.cos(angle), r * Math.sin(angle))
  }
  shape.closePath()

  // Inner hole: smaller semicircle (radius r - t), same start/end.
  const ri = r - t
  const hole = new THREE.Path()
  hole.moveTo(t, 0)
  for (let i = 1; i <= segs; i++) {
    const angle = Math.PI + (Math.PI * i) / segs
    hole.lineTo(r + ri * Math.cos(angle), ri * Math.sin(angle))
  }
  hole.closePath()
  shape.holes.push(hole)
  return shape
}

// Simple square box (rectangular u-channel). Reads as commercial /
// industrial. Width equals size (deep-and-narrow ratio).
function buildBoxCross(size: number, t: number): THREE.Shape {
  const w = size

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0, -size)
  shape.lineTo(w, -size)
  shape.lineTo(w, 0)
  shape.closePath()

  const hole = new THREE.Path()
  hole.moveTo(t, -t)
  hole.lineTo(t, -size + t)
  hole.lineTo(w - t, -size + t)
  hole.lineTo(w - t, -t)
  hole.closePath()
  shape.holes.push(hole)
  return shape
}
