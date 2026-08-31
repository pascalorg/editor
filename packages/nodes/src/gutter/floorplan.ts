import type {
  AnyNodeId,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  GutterNode,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { computeGutterMitres, type GutterWithSegment } from './corner-mitre'
import { EAVE_TUCK_INWARD } from './eave-snap'
import { outletDims, outletShapeForProfile, profileFloorMidZ } from './profile-geometry'

/**
 * Floor-plan builder for a gutter. A gutter is a thin rain-water channel
 * hosted on a roof segment, running along an eave. In plan it reads as a
 * narrow metal strip just outboard of the eave line: the trough (two long
 * edges), end caps where the trough is closed, hanger straps across the
 * run, and a downspout outlet symbol where one is fitted.
 *
 * The coordinate frame mirrors the 3D transform stack
 * (roof → roof-segment → gutter). The gutter's `position` is
 * segment-local and the segment's is roof-local, so we compose
 *   world = roof.pos + R(roof) · (seg.pos + R(seg) · gutter.pos)
 * using the floor-plan's negated-rotation convention (see
 * `buildRoofSegmentFloorplan`). Gutter-local +X is the run (along the
 * eave); +Z hangs outward, away from the building.
 */
export function buildGutterFloorplan(
  node: GutterNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const segment = ctx.parent as RoofSegmentNode | null
  if (segment?.type !== 'roof-segment') return null
  const roofId = segment.parentId as AnyNodeId | null
  const roof = roofId ? (ctx.resolve(roofId) as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  // Compose roof → segment → gutter in plan coords. Each rotation is
  // negated so SVG's y-down CW matches Three.js' top-down CCW — the same
  // convention the roof-segment builder establishes.
  const cosR = Math.cos(-roof.rotation)
  const sinR = Math.sin(-roof.rotation)
  const segCx = roof.position[0] + segment.position[0] * cosR - segment.position[2] * sinR
  const segCz = roof.position[2] + segment.position[0] * sinR + segment.position[2] * cosR

  const segRot = -(roof.rotation + segment.rotation)
  const cosS = Math.cos(segRot)
  const sinS = Math.sin(segRot)
  const cx = segCx + node.position[0] * cosS - node.position[2] * sinS
  const cz = segCz + node.position[0] * sinS + node.position[2] * cosS

  const gutterRot = -(roof.rotation + segment.rotation + node.rotation)
  const cos = Math.cos(gutterRot)
  const sin = Math.sin(gutterRot)
  const toPlan = (lx: number, lz: number): FloorplanPoint => [
    cx + lx * cos - lz * sin,
    cz + lx * sin + lz * cos,
  ]

  const halfLen = Math.max(node.length, 0.1) / 2
  const width = Math.max(node.size, 0.05) // outward extent of the trough

  // The gutter's stored position is the eave drip edge — `halfD + overhang`
  // out from the segment centre (resolveEaveSnap). The roof floor plan
  // draws only the structural footprint (no overhang), so to seat the
  // trough on the drawn roof edge we shift it inward by that overhang
  // excess. Local Z then reads: `backZ` = back/fascia edge (on the roof
  // edge), `rimZ` = outward lip.
  //
  // A plain inward shift would break mitred corners — the two meeting
  // gutters lie on perpendicular eaves, so each shifts a different way and
  // their ends part (they cross). We compensate in the corner math below
  // by also retracting each MITRED end along the run by the same inset:
  // the net move at a corner is then identical for both gutters, so they
  // still meet — now at the structural corner. Exact for right-angle
  // (hip / rectangular) corners.
  const eaveInset = Math.max(0, (segment.overhang ?? 0) - EAVE_TUCK_INWARD)
  const backZ = -eaveInset
  const rimZ = width - eaveInset

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Gutters are a metal accessory — read them in a cooler grey than the
  // roof's black structural ink, accent on select, light blue on hover.
  const baseInk = '#475569'
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : baseInk
  const fill = showSelectedChrome ? '#fed7aa' : '#cbd5e1'
  const fillOpacity = showSelectedChrome ? 0.5 : 0.4
  const lineWidth = showSelectedChrome ? 0.03 : 0.022

  // Corner mitres — when a sibling gutter meets this one at a roof
  // corner, that shared end is open: the back wall stays at the corner
  // while the rim extends outward to the mitre, and the cap is
  // suppressed. Mirrors the 3D builder's rule (`endCap* && mitre === 0`).
  // `left` = −X end, `right` = +X end.
  //
  // Cross-segment: collect every other gutter on the roof paired with its
  // host segment (mirrors the renderer's `mitreNodes` walk) so gutters
  // meeting where two segments join still mitre, not just same-segment.
  const mitreSiblings: GutterWithSegment[] = []
  for (const segId of roof.children ?? []) {
    const sib = ctx.resolve(segId as AnyNodeId) as RoofSegmentNode | undefined
    if (sib?.type !== 'roof-segment') continue
    for (const gid of sib.children ?? []) {
      const g = ctx.resolve(gid as AnyNodeId) as GutterNode | undefined
      if (g && g.type === 'gutter' && g.id !== node.id) {
        mitreSiblings.push({ gutter: g, segment: sib })
      }
    }
  }
  const mitres = computeGutterMitres(node, segment, mitreSiblings)
  const capRight = node.endCapRight && mitres.right === 0
  const capLeft = node.endCapLeft && mitres.left === 0

  // Footprint corners. Back edge sits on the roof edge (lz = backZ); the
  // rim hangs outward (lz = rimZ). A mitred end (a) retracts along the run
  // by `eaveInset` so its back corner lands on the structural corner, then
  // (b) skews its rim corner by the SIGNED mitre (`Math.tan` carries the
  // sign: convex extends, concave retracts) so adjacent gutters' rims meet
  // at the corner. Non-mitred ends (mitre === 0) keep the full run.
  const backRightX = halfLen - (mitres.right !== 0 ? eaveInset : 0)
  const backLeftX = -(halfLen - (mitres.left !== 0 ? eaveInset : 0))
  const backLeft = toPlan(backLeftX, backZ)
  const backRight = toPlan(backRightX, backZ)
  const rimRight = toPlan(backRightX + width * Math.tan(mitres.right), rimZ)
  const rimLeft = toPlan(backLeftX - width * Math.tan(mitres.left), rimZ)

  const children: FloorplanGeometry[] = [
    // Transparent hit-target across the whole channel so the thin strip
    // is easy to click-select in plan.
    {
      kind: 'polygon',
      points: [backLeft, backRight, rimRight, rimLeft],
      fill: stroke,
      fillOpacity: 0,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'all',
    },
    // Channel fill.
    {
      kind: 'polygon',
      points: [backLeft, backRight, rimRight, rimLeft],
      fill,
      fillOpacity,
      stroke: 'none',
      strokeWidth: 0,
      pointerEvents: 'none',
    },
    // Long edges — the back (fascia) line and the front lip. These two
    // parallel lines are the gutter's signature read in plan.
    {
      kind: 'line',
      x1: backLeft[0],
      y1: backLeft[1],
      x2: backRight[0],
      y2: backRight[1],
      stroke,
      strokeWidth: lineWidth,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    },
    {
      kind: 'line',
      x1: rimLeft[0],
      y1: rimLeft[1],
      x2: rimRight[0],
      y2: rimRight[1],
      stroke,
      strokeWidth: lineWidth,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    },
  ]

  // End edges. A capped end gets a square closure line; a mitred end gets
  // the slanted mitre seam (so the joint shows in plan); an open, uncapped
  // end gets nothing. `cap*` already excludes mitred ends, so an end never
  // draws both a cap and a seam.
  if (capLeft || mitres.left !== 0) {
    children.push({
      kind: 'line',
      x1: backLeft[0],
      y1: backLeft[1],
      x2: rimLeft[0],
      y2: rimLeft[1],
      stroke,
      strokeWidth: lineWidth,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    })
  }
  if (capRight || mitres.right !== 0) {
    children.push({
      kind: 'line',
      x1: backRight[0],
      y1: backRight[1],
      x2: rimRight[0],
      y2: rimRight[1],
      stroke,
      strokeWidth: lineWidth,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    })
  }

  // Hanger straps — short ticks across the trough at the real hanger
  // spacing, so the strip reads as a gutter rather than a thin wall.
  if (node.hangerStyle === 'strap') {
    const spacing = Math.max(node.hangerSpacing, 0.2)
    const inset = width * 0.15
    // Span the (possibly retracted) run between the two end corners.
    const mid = (backLeftX + backRightX) / 2
    const runLen = backRightX - backLeftX
    const count = Math.max(1, Math.floor(runLen / spacing))
    const span = count * spacing
    for (let i = 0; i < count; i++) {
      const x = mid - span / 2 + spacing / 2 + i * spacing
      if (x <= backLeftX + 0.02 || x >= backRightX - 0.02) continue
      const a = toPlan(x, backZ + inset)
      const b = toPlan(x, rimZ - inset)
      children.push({
        kind: 'line',
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        stroke,
        strokeWidth: lineWidth * 0.7,
        strokeLinecap: 'round',
        opacity: 0.6,
        pointerEvents: 'none',
      })
    }
  }

  // Downspout outlets — a leader symbol per outlet (round for half-round
  // gutters, rectangular for k-style / box, following the profile) at each
  // outlet's along-run position. The strongest "this is a gutter" cue in a
  // roof plan. `offset` is signed from the gutter centre along +X.
  // `outlets` is a recent schema addition — gutters persisted before it
  // existed deserialize without the field (the schema default only fills
  // on a fresh parse), so guard against `undefined`.
  const outlets = node.outlets ?? []
  if (outlets.length > 0) {
    const floorZ = Math.min(
      Math.max(profileFloorMidZ(node.profile, width), width * 0.25),
      width * 0.85,
    )
    const outletZ = backZ + floorZ
    const shape = outletShapeForProfile(node.profile)
    const outStroke = showSelectedChrome && palette ? palette.selectedStroke : '#1e293b'
    for (const outlet of outlets) {
      // Clamp inside the run so the symbol never rides out onto a cap line
      // (the 3D builder clamps the drill the same way).
      const outletX = Math.max(-halfLen * 0.9, Math.min(halfLen * 0.9, outlet.offset))
      const dims = outletDims(shape, outlet.diameter)
      if (shape === 'round') {
        const center = toPlan(outletX, outletZ)
        children.push({
          kind: 'circle',
          cx: center[0],
          cy: center[1],
          r: Math.max(dims.halfX, 0.03),
          fill: 'none',
          stroke: outStroke,
          strokeWidth: lineWidth,
          pointerEvents: 'none',
        })
      } else {
        children.push({
          kind: 'polygon',
          points: [
            toPlan(outletX - dims.halfX, outletZ - dims.halfZ),
            toPlan(outletX + dims.halfX, outletZ - dims.halfZ),
            toPlan(outletX + dims.halfX, outletZ + dims.halfZ),
            toPlan(outletX - dims.halfX, outletZ + dims.halfZ),
          ],
          fill: 'none',
          stroke: outStroke,
          strokeWidth: lineWidth,
          pointerEvents: 'none',
        })
      }
    }
  }

  return { kind: 'group', children }
}
