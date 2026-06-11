import type { GutterNode } from '@pascal-app/core'
import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { type GutterMitres, NO_MITRES } from './corner-mitre'
import {
  OUTLET_STUB_LENGTH,
  OUTLET_WALL_THICKNESS,
  type OutletDims,
  type OutletShape,
  outletDims,
  outletShapeForProfile,
  profileFloorMidZ,
} from './profile-geometry'

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
 * End caps: when `endCapLeft` / `endCapRight` is true, the matching
 * end gets a thin SOLID slice (depth = wall thickness) instead of the
 * hollow U-channel. The solid slice's end face closes the trough so
 * water can't run out the side. Caps subtract from the user-set
 * `length` so the gutter's total span stays constant — capping doesn't
 * silently grow the geometry past what the inspector reads.
 *
 * Corner mitres: when a sibling gutter meets this gutter at a roof
 * corner, the corner-mitre detector passes a mitre angle for the
 * affected end. The end-face vertices are skewed (back wall held in
 * place, front rim extended outward) so two perpendicular gutters'
 * front rims meet at the outer eave intersection. A mitred end's cap
 * is force-suppressed — capping a corner would wall off the L.
 *
 * Pure: no React, no scene access, no store mutation.
 */
export function buildGutterGeometry(
  node: GutterNode,
  mitres: GutterMitres = NO_MITRES,
): THREE.BufferGeometry {
  const len = Math.max(0.05, node.length)
  const size = Math.max(0.04, node.size)
  const t = Math.min(Math.max(0.001, node.thickness), size * 0.4)

  const capLeft = (node.endCapLeft ?? true) && mitres.left === 0
  const capRight = (node.endCapRight ?? true) && mitres.right === 0

  // Reserve cap slices at each capped end. Each cap is `t` thick
  // (matches the wall thickness — a real end cap is a stamped plate
  // welded onto the gutter). Clamp so a tiny gutter doesn't end up
  // all-cap-no-channel.
  const reserved = (capLeft ? t : 0) + (capRight ? t : 0)
  const channelLen = Math.max(len * 0.1, len - reserved)
  const totalCap = len - channelLen
  const capLeftLen = capLeft ? (capRight ? totalCap / 2 : totalCap) : 0
  const capRightLen = capRight ? (capLeft ? totalCap / 2 : totalCap) : 0

  let channelCross: THREE.Shape
  let capCross: THREE.Shape
  if (node.profile === 'half-round') {
    channelCross = buildHalfRoundCross(size, t)
    capCross = buildHalfRoundOuterOnly(size)
  } else if (node.profile === 'box') {
    channelCross = buildBoxCross(size, t)
    capCross = buildBoxOuterOnly(size)
  } else {
    channelCross = buildKStyleCross(size, t)
    capCross = buildKStyleOuterOnly(size)
  }

  // Each extrude below uses the same orient-and-recenter recipe:
  // ExtrudeGeometry produces (mesh-X = cross-X, mesh-Y = cross-Y,
  // mesh-Z = extrusion axis); we rotateY(-π/2) so the LENGTH lands
  // along mesh-+X and the OUTWARD direction lands along mesh-+Z, then
  // translate so the piece sits in its slot of the gutter's overall
  // [-len/2, +len/2] span. Z_cs = 0 maps to mesh-+X (right end);
  // Z_cs = depth maps to mesh--X (left end).
  const pieces: THREE.BufferGeometry[] = []

  let channel: THREE.BufferGeometry = new THREE.ExtrudeGeometry(channelCross, {
    depth: channelLen,
    bevelEnabled: false,
    curveSegments: 16,
    steps: 1,
  })
  // Apply the corner-mitre skew while we're still in the source frame.
  // Source axes (pre-rotation): X_cs = outward, Y_cs = vertical,
  // Z_cs = length (0 at right end of mesh, `channelLen` at left end).
  // After rotateY(-π/2): mesh-X = -Z_cs, mesh-Z = X_cs.
  //
  // Corner mitre rule: the back wall (X_cs = 0) stays at the original
  // end (mesh-X = ±len/2); the front rim (X_cs = +outward) is SKEWED
  // along the gutter's length to reach the eave intersection of the L.
  // The mitre is SIGNED — positive (convex / outer corner) extends the
  // rim past the end; negative (concave / inner corner) retracts it to
  // the inner intersection. `Math.tan` carries the sign, so the same
  // formula handles both. In mesh coords:
  //   right end: Δmesh-X = +mesh-Z · tan(mitreRight)
  //   left  end: Δmesh-X = −mesh-Z · tan(mitreLeft)
  // Mapped back to source coords (Δmesh-X = −ΔZ_cs, mesh-Z = X_cs):
  //   right end (Z_cs = 0):           new Z_cs = −X_cs · tan(mitreRight)
  //   left  end (Z_cs = channelLen):  new Z_cs = channelLen + X_cs · tan(mitreLeft)
  if (mitres.right !== 0 || mitres.left !== 0) {
    // Drop the cross-section CAP at each mitred end first. Both gutters
    // at a corner skew their end faces onto the SAME mitre plane, so the
    // thin metal-section caps land coincident and z-fight into the stray
    // seam lines visible at the joint (and the ink-edge pass outlines
    // them). With the caps gone the open troughs flow into each other and
    // the side walls carry the corner — a clean seam. Done before the
    // skew so the end planes are still the clean z=0 / z=channelLen.
    const stripped = stripEndCaps(channel, channelLen, mitres.right !== 0, mitres.left !== 0)
    channel.dispose()
    channel = stripped

    const tanRight = Math.tan(mitres.right)
    const tanLeft = Math.tan(mitres.left)
    const eps = 1e-5
    const pos = channel.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      if (mitres.right !== 0 && Math.abs(z) < eps) {
        pos.setZ(i, -x * tanRight)
      } else if (mitres.left !== 0 && Math.abs(z - channelLen) < eps) {
        pos.setZ(i, channelLen + x * tanLeft)
      }
    }
    pos.needsUpdate = true
    channel.computeVertexNormals()
  }
  channel.rotateY(-Math.PI / 2)
  // Channel spans [-len/2 + capLeftLen, +len/2 - capRightLen]: shift
  // the recentered extrude so its right end butts against the right cap.
  channel.translate(len / 2 - capRightLen, 0, 0)
  pieces.push(channel)

  if (capLeft) {
    const leftCap = new THREE.ExtrudeGeometry(capCross, {
      depth: capLeftLen,
      bevelEnabled: false,
      curveSegments: 16,
      steps: 1,
    })
    leftCap.rotateY(-Math.PI / 2)
    // Left cap spans [-len/2, -len/2 + capLeftLen]: translate by
    // -len/2 + capLeftLen so Z_cs=0 (mesh-+X end of the cap slice)
    // sits at -len/2 + capLeftLen and Z_cs=depth at -len/2.
    leftCap.translate(-len / 2 + capLeftLen, 0, 0)
    pieces.push(leftCap)
  }

  if (capRight) {
    const rightCap = new THREE.ExtrudeGeometry(capCross, {
      depth: capRightLen,
      bevelEnabled: false,
      curveSegments: 16,
      steps: 1,
    })
    rightCap.rotateY(-Math.PI / 2)
    // Right cap spans [+len/2 - capRightLen, +len/2].
    rightCap.translate(len / 2, 0, 0)
    pieces.push(rightCap)
  }

  // Hangers: thin metal straps spanning the rim from the back wall to
  // the front rim, repeated along the length. Each strap is a small
  // box centered on Y=0 (the eave line, where the rim sits) with its
  // top ~3mm above the rim — so it reads as a clip resting on the
  // gutter rather than buried in it.
  if ((node.hangerStyle ?? 'strap') !== 'none') {
    for (const hanger of buildHangers(node, len, size, capLeftLen, capRightLen, mitres)) {
      pieces.push(hanger)
    }
  }

  // Downspout outlets: short drop-tube collars hanging off the gutter
  // floor at each outlet's position. Each collar is solid at the outer
  // (bore + wall) cross-section; the bore is then drilled through both
  // the floor and the collar via CSG, so the result is a real hole in
  // the trough floor and a hollow tube descending from it. CSG only
  // runs when at least one outlet exists — an empty `outlets` keeps the
  // fast merge path.
  const placements = resolveOutletPlacements(node, len, size, capLeftLen, capRightLen)
  for (const p of placements) {
    pieces.push(buildOutletStub(p, size))
    // Flared funnel lip at the floor so the drop reads as a real drop
    // outlet rather than a bare tube; the same bore drill cuts it open.
    pieces.push(buildOutletFunnel(p, size))
  }

  const merged = pieces.length === 1 ? pieces[0]! : (mergeGeometries(pieces, false) ?? pieces[0]!)
  // Free the intermediate pieces when merge returned a new geometry.
  if (merged !== pieces[0]) {
    for (const p of pieces) p.dispose()
  }
  merged.computeVertexNormals()

  // CSG drill — punches each bore through the merged geometry. Runs
  // last so the floor + collars are already in one mesh; each drill
  // cuts both at once, subtracted sequentially.
  if (placements.length > 0) {
    let workingBrush = new Brush(merged)
    prepareBrushForCSG(workingBrush)
    for (const p of placements) {
      const drill = buildOutletDrill(p, size)
      const drillBrush = new Brush(drill)
      prepareBrushForCSG(drillBrush)
      const next = csgEvaluator.evaluate(workingBrush, drillBrush, SUBTRACTION) as Brush
      prepareBrushForCSG(next)
      // Free the previous step's intermediate result (but not `merged`,
      // which is disposed once below).
      if (workingBrush.geometry !== merged) workingBrush.geometry.dispose()
      workingBrush = next
      drill.dispose()
    }
    const cutGeometry = csgGeometry(workingBrush)
    merged.dispose()
    return cutGeometry
  }

  return merged
}

// Remove the extrude's cross-section CAP triangles at a mitred end so two
// gutters meeting at a corner don't leave coincident, z-fighting end
// faces (the seam lines at the joint). A cap triangle is one whose three
// vertices ALL lie on an end plane — z≈0 (right end) or z≈channelLen
// (left end). Wall triangles always span the two planes, so this cleanly
// separates caps from walls without depending on ExtrudeGeometry's
// internal vertex order. Input is non-indexed (ExtrudeGeometry), so every
// three positions is one triangle; we copy through the survivors and let
// the caller recompute normals.
function stripEndCaps(
  geo: THREE.BufferGeometry,
  channelLen: number,
  removeRight: boolean,
  removeLeft: boolean,
): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo
  const pos = src.attributes.position!
  const uv = src.attributes.uv
  const eps = 1e-4
  const keepPos: number[] = []
  const keepUv: number[] | null = uv ? [] : null
  const triCount = Math.floor(pos.count / 3)
  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    const za = pos.getZ(a)
    const zb = pos.getZ(a + 1)
    const zc = pos.getZ(a + 2)
    const allRight = Math.abs(za) < eps && Math.abs(zb) < eps && Math.abs(zc) < eps
    const allLeft =
      Math.abs(za - channelLen) < eps &&
      Math.abs(zb - channelLen) < eps &&
      Math.abs(zc - channelLen) < eps
    if ((removeRight && allRight) || (removeLeft && allLeft)) continue
    for (let k = 0; k < 3; k++) {
      const idx = a + k
      keepPos.push(pos.getX(idx), pos.getY(idx), pos.getZ(idx))
      if (keepUv && uv) keepUv.push(uv.getX(idx), uv.getY(idx))
    }
  }
  if (src !== geo) src.dispose()
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(keepPos, 3))
  if (keepUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(keepUv, 2))
  return out
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

// Solid-outer outlines used for the end-cap slices: same outer
// boundary as the channel cross-sections above but without the inner
// trough carved out, so the extruded slice is a solid plug that closes
// the open end of the trough.

function buildKStyleOuterOnly(size: number): THREE.Shape {
  const wBot = size * 0.8
  const wTop = size * 0.95
  const ogeeY = -size * 0.65

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0, -size)
  shape.lineTo(wBot, -size)
  shape.bezierCurveTo(wBot + size * 0.15, ogeeY, wTop - size * 0.15, ogeeY * 0.4, wTop, 0)
  // closePath draws (wTop, 0) → (0, 0) — the cap's rim line across
  // the top of the gutter cross-section.
  shape.closePath()
  return shape
}

function buildHalfRoundOuterOnly(size: number): THREE.Shape {
  const r = size
  const segs = 24

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  for (let i = 1; i <= segs; i++) {
    const angle = Math.PI + (Math.PI * i) / segs
    shape.lineTo(r + r * Math.cos(angle), r * Math.sin(angle))
  }
  shape.closePath()
  return shape
}

function buildBoxOuterOnly(size: number): THREE.Shape {
  const w = size

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0, -size)
  shape.lineTo(w, -size)
  shape.lineTo(w, 0)
  shape.closePath()
  return shape
}

// ─── Hangers ───────────────────────────────────────────────────────

// Strap dimensions — a residential hidden hanger reads as a flat band
// roughly 25mm wide along the gutter, 3mm thick, sitting on the rim.
const HANGER_BAR_LEN = 0.025
const HANGER_BAR_THICKNESS = 0.003
// Extra spread past the rim's outward extent — so the strap looks like
// it "wraps over" both edges rather than ending flush.
const HANGER_OVERHANG = 0.005
// Distance from each gutter end where a strap is allowed to sit; keeps
// straps from clashing with end caps and from looking pinned to the
// very edge.
const HANGER_END_MARGIN = 0.05

/** Outward Z extent of each profile, used to size the strap. */
function profileRimWidth(profile: GutterNode['profile'], size: number): number {
  if (profile === 'half-round') return 2 * size
  if (profile === 'box') return size
  return size * 0.95 // k-style wTop
}

function buildHangers(
  node: GutterNode,
  len: number,
  size: number,
  capLeftLen: number,
  capRightLen: number,
  mitres: GutterMitres,
): THREE.BufferGeometry[] {
  const spacing = Math.max(0.2, node.hangerSpacing ?? 0.6)
  const profile = node.profile ?? 'k-style'
  const rimWidth = profileRimWidth(profile, size)
  const strapDepth = rimWidth + HANGER_OVERHANG * 2

  // At an INNER (concave) corner the two gutters' troughs fold into the
  // same notch, so a strap sitting near that end overlaps the neighbour
  // gutter's end strap — the two perpendicular straps read as an X across
  // the corner. Pull the run's bound back by a full strap depth at a
  // concave end so the nearest strap clears the joint. OUTER (convex)
  // corners diverge outward and never overlap, so they keep the tight
  // margin (`mitre > 0` and non-mitred ends → no extra inset).
  const concaveInset = (mitre: number) => (mitre < 0 ? strapDepth : 0)

  // Inset by margin AND any cap so straps don't punch into the cap slab,
  // plus the concave-corner clearance above.
  const leftBound = -len / 2 + capLeftLen + HANGER_END_MARGIN + concaveInset(mitres.left)
  const rightBound = len / 2 - capRightLen - HANGER_END_MARGIN - concaveInset(mitres.right)
  const usable = rightBound - leftBound
  if (usable <= 0) return []

  // Span the usable run with straps at `spacing` between centers, plus
  // one at each end. Symmetric layout for any length, including very
  // short gutters where two straps land at the bounds.
  const count = Math.max(1, Math.floor(usable / spacing) + 1)
  const stride = count > 1 ? usable / (count - 1) : 0

  const pieces: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const x = count > 1 ? leftBound + i * stride : (leftBound + rightBound) / 2
    // BoxGeometry is indexed; the channel + cap ExtrudeGeometries are
    // not. `mergeGeometries` rejects mixed-index sets, so flatten the
    // box to non-indexed before pushing.
    const bar = new THREE.BoxGeometry(
      HANGER_BAR_LEN,
      HANGER_BAR_THICKNESS,
      strapDepth,
    ).toNonIndexed()
    // Center the bar at X = position, Y just above the rim line, Z
    // straddling 0 so the strap covers the full back-to-front span.
    bar.translate(x, HANGER_BAR_THICKNESS / 2 + 0.001, rimWidth / 2)
    pieces.push(bar)
  }
  return pieces
}

// ─── Outlet ────────────────────────────────────────────────────────

// Radial subdivisions — 24 reads as smooth at typical outlet
// diameters; lower and the 3″ tube starts looking faceted from below.
const OUTLET_RADIAL_SEGMENTS = 24
// Drill overshoot past the floor and past the stub bottom — keeps the
// CSG cut planes from coinciding with merged-geometry surfaces
// (coplanar cuts produce degenerate output in three-bvh-csg).
const OUTLET_DRILL_OVERSHOOT = 0.01
// Funnel lip at the drop outlet — flares this much wider than the collar
// over this height, just below the trough floor. The bore drill cuts it
// open along with the collar.
const OUTLET_FLARE_SCALE = 1.6
const OUTLET_FLARE_HEIGHT = 0.02

type OutletPlacement = {
  x: number
  z: number
  shape: OutletShape
  /** Bore cross-section (the drilled hole). */
  inner: OutletDims
  /** Collar cross-section (bore + wall) — the solid stub body. */
  outer: OutletDims
}

/**
 * One placement per `node.outlets` entry that fits between the caps. The
 * shape follows the gutter profile (`outletShapeForProfile`): round
 * leader on half-round, rectangular on k-style / box. Each outlet's
 * `offset` (signed from center) is clamped inside the trough-floor span
 * using the OUTER along-length half-extent so the collar can't poke into
 * a cap. Outlets that can't fit at all are dropped.
 */
function resolveOutletPlacements(
  node: GutterNode,
  len: number,
  size: number,
  capLeftLen: number,
  capRightLen: number,
): OutletPlacement[] {
  const outlets = node.outlets ?? []
  if (outlets.length === 0) return []

  const shape = outletShapeForProfile(node.profile)
  const z = profileFloorMidZ(node.profile ?? 'k-style', size)
  const placements: OutletPlacement[] = []
  for (const outlet of outlets) {
    const inner = outletDims(shape, outlet.diameter ?? 0.07)
    const outer: OutletDims = {
      shape,
      halfX: inner.halfX + OUTLET_WALL_THICKNESS,
      halfZ: inner.halfZ + OUTLET_WALL_THICKNESS,
    }
    const minX = -len / 2 + capLeftLen + outer.halfX
    const maxX = len / 2 - capRightLen - outer.halfX
    if (maxX <= minX) continue
    const x = Math.max(minX, Math.min(maxX, outlet.offset ?? 0))
    placements.push({ x, z, shape, inner, outer })
  }
  return placements
}

/** Cylinder (round) or box (rect) sized to `dims`, height `h` along Y. */
function outletSolid(dims: OutletDims, h: number): THREE.BufferGeometry {
  if (dims.shape === 'round') {
    return new THREE.CylinderGeometry(
      dims.halfX,
      dims.halfX,
      h,
      OUTLET_RADIAL_SEGMENTS,
    ).toNonIndexed()
  }
  return new THREE.BoxGeometry(2 * dims.halfX, h, 2 * dims.halfZ).toNonIndexed()
}

/**
 * Solid collar at the OUTER cross-section; the CSG drill hollows out the
 * bore and leaves a tube wall. Top sits flush with the gutter floor
 * (Y = −size). Flattened to match the ExtrudeGeometries.
 */
function buildOutletStub(p: OutletPlacement, size: number): THREE.BufferGeometry {
  const stub = outletSolid(p.outer, OUTLET_STUB_LENGTH)
  stub.translate(p.x, -size - OUTLET_STUB_LENGTH / 2, p.z)
  return stub
}

/**
 * Flared funnel lip just below the trough floor — wide at the floor,
 * tapering to the collar below (round → a cone; rect → a stepped wider
 * lip). Sits in the bore drill's span so it gets cut open too.
 */
function buildOutletFunnel(p: OutletPlacement, size: number): THREE.BufferGeometry {
  const centerY = -size - OUTLET_FLARE_HEIGHT / 2
  let funnel: THREE.BufferGeometry
  if (p.shape === 'round') {
    funnel = new THREE.CylinderGeometry(
      p.outer.halfX * OUTLET_FLARE_SCALE,
      p.outer.halfX,
      OUTLET_FLARE_HEIGHT,
      OUTLET_RADIAL_SEGMENTS,
    ).toNonIndexed()
  } else {
    funnel = new THREE.BoxGeometry(
      2 * p.outer.halfX * OUTLET_FLARE_SCALE,
      OUTLET_FLARE_HEIGHT,
      2 * p.outer.halfZ * OUTLET_FLARE_SCALE,
    ).toNonIndexed()
  }
  funnel.translate(p.x, centerY, p.z)
  return funnel
}

/**
 * Bore drill — spans from slightly above the trough floor to slightly
 * below the collar's bottom; the overshoots keep CSG cut planes from
 * sitting coplanar with merged-geometry faces.
 */
function buildOutletDrill(p: OutletPlacement, size: number): THREE.BufferGeometry {
  const top = -size + OUTLET_DRILL_OVERSHOOT
  const bottom = -size - OUTLET_STUB_LENGTH - OUTLET_DRILL_OVERSHOOT
  const height = top - bottom
  const centerY = (top + bottom) / 2

  const drill = outletSolid(p.inner, height)
  drill.translate(p.x, centerY, p.z)
  return drill
}
