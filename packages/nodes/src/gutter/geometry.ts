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

// Each cross-section below is authored as a single closed polygon that
// traces the U-channel's MATERIAL — outer wall down → bottom → outer
// wall up → rim across → inner wall down → inner bottom → inner wall
// up → closing rim. The interior of the U (where rainwater sits) is
// empty space, not a hole — so the extrude has an OPEN TOP, which is
// what makes the geometry read as a gutter rather than a sealed box
// with a tunnel through it.
//
// Cross-section authoring frame: X is the gutter's outward direction
// (X=0 against the fascia, X=+w hanging outward); Y is vertical (Y=0
// at the eave line, Y=-size at the bottom of the trough). After the
// rotateY(-π/2) in the parent builder, +X maps to segment-outward (+Z)
// and the extrude axis (length) maps to segment-+X.

function buildKStyleCross(size: number, t: number): THREE.Shape {
  const wBot = size * 0.8 // bottom outer width — narrower than the rim
  const wTop = size * 0.95
  const ogeeY = -size * 0.65 // S-curve inflection on the fascia

  const shape = new THREE.Shape()
  // Outer trace — top-back → down the back → across the bottom → up
  // the ogee fascia.
  shape.moveTo(0, 0)
  shape.lineTo(0, -size)
  shape.lineTo(wBot, -size)
  shape.bezierCurveTo(wBot + size * 0.15, ogeeY, wTop - size * 0.15, ogeeY * 0.4, wTop, 0)
  // Front rim (thin top of the front wall): step inward by `t`.
  shape.lineTo(wTop - t, 0)
  // Inner trace — back down the ogee, across the inner bottom, up the
  // inner back wall. Same bezier control points pushed inward by `t`.
  shape.bezierCurveTo(
    wTop - size * 0.15 - t,
    ogeeY * 0.4,
    wBot + size * 0.15 - t,
    ogeeY,
    wBot - t,
    -size + t,
  )
  shape.lineTo(t, -size + t)
  shape.lineTo(t, 0)
  // closePath draws the back rim (t, 0) → (0, 0) — the thin top of
  // the back wall, sealing the cross-section.
  shape.closePath()
  return shape
}

// Half-round trough — a semicircular cross-section with a smaller
// concentric semicircle carved out. Single closed trace: outer half
// from (0,0) sweeping down and back up to (2r, 0), front rim across by
// `t`, inner half from (2r-t, 0) sweeping back to (t, 0), back rim
// closes the loop.
function buildHalfRoundCross(size: number, t: number): THREE.Shape {
  const r = size // radius == size: half-circle drops `size` below the eave
  const ri = r - t // inner radius
  const segs = 24

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  // Outer semicircle, lower half (angle π → 2π). At i=0 we'd be at
  // (0,0) — already there from moveTo — so start at i=1.
  for (let i = 1; i <= segs; i++) {
    const angle = Math.PI + (Math.PI * i) / segs
    shape.lineTo(r + r * Math.cos(angle), r * Math.sin(angle))
  }
  // Front rim — step inward by `t` to start the inner trace.
  shape.lineTo(2 * r - t, 0)
  // Inner semicircle, traced BACK toward the back wall (angle 2π → π).
  for (let i = 1; i <= segs; i++) {
    const angle = 2 * Math.PI - (Math.PI * i) / segs
    shape.lineTo(r + ri * Math.cos(angle), ri * Math.sin(angle))
  }
  // closePath draws (t, 0) → (0, 0) — back rim.
  shape.closePath()
  return shape
}

// Square / rectangular box U-channel. Width equals size (deep-and-
// narrow ratio reads as commercial). Traced as outer rect → front rim
// → inner rect (reverse) → back rim.
function buildBoxCross(size: number, t: number): THREE.Shape {
  const w = size

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0, -size)
  shape.lineTo(w, -size)
  shape.lineTo(w, 0)
  // Front rim.
  shape.lineTo(w - t, 0)
  // Inner rect, reversed so the polygon doesn't self-intersect.
  shape.lineTo(w - t, -size + t)
  shape.lineTo(t, -size + t)
  shape.lineTo(t, 0)
  // closePath draws the back rim (t, 0) → (0, 0).
  shape.closePath()
  return shape
}
