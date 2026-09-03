import type { FloorplanGeometry } from '@pascal-app/core'
import { boundsOf, segmentInsidePolygon } from './math'
import { CASING, doorGlyph, windowGlyph } from './openings'
import type { BuildingModel, Opening, PrismSolid, RoofSolid, WallSolid } from './scene-model'
import {
  BRICK_COURSE,
  type FaceHole,
  finishHatch,
  formatFeetInches,
  gradeTicks,
  LAP_EXPOSURE,
  scanlinesInPolygon,
  SHINGLE_COURSE,
  STONE_COURSE,
} from './materials'
import {
  DASH,
  INK,
  line,
  PAPER,
  POCHE_ROOF,
  polygon as polygonPrimitive,
  polyline,
  rectPolygon,
  WEIGHT,
} from './style'
import type { Vec2 } from './types'

/**
 * An orthographic view of the building: a horizontal RIGHT axis `r` and a
 * horizontal FORWARD axis `f` (the direction the viewer looks), both unit
 * vectors in world plan coords. `origin` is the plan point that maps to
 * drawing x = 0.
 *
 * `f` and `r` obey the camera convention `right = forward × up` with
 * `up = +Y`, i.e. `r = (-f.z, f.x)`. That is what makes a south elevation
 * read with east on the right.
 */
export type Projector = {
  origin: Vec2
  right: Vec2
  forward: Vec2
  /** Only geometry with `depth` in [depthMin, depthMax] is drawn. */
  depthMin: number
  depthMax: number
}

export function makeProjector(
  origin: Vec2,
  forward: Vec2,
  depthMin: number,
  depthMax: number,
): Projector {
  const length = Math.hypot(forward[0], forward[1]) || 1
  const f: Vec2 = [forward[0] / length, forward[1] / length]
  return { origin, forward: f, right: [-f[1], f[0]], depthMin, depthMax }
}

export function projectU(view: Projector, x: number, z: number): number {
  return (x - view.origin[0]) * view.right[0] + (z - view.origin[1]) * view.right[1]
}

export function projectDepth(view: Projector, x: number, z: number): number {
  return (x - view.origin[0]) * view.forward[0] + (z - view.origin[1]) * view.forward[1]
}

/** Drawing y for a world elevation. See the DRAWING SPACE note in `types.ts`. */
export const drawY = (elevation: number): number => -elevation

// ---------------------------------------------------------------------------
// Polygon clipping against the view's depth slab (Sutherland–Hodgman).
// ---------------------------------------------------------------------------

function clipHalfPlane(
  poly: readonly Vec2[],
  inside: (p: Vec2) => boolean,
  intersect: (a: Vec2, b: Vec2) => Vec2,
): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < poly.length; i++) {
    const current = poly[i]!
    const previous = poly[(i + poly.length - 1) % poly.length]!
    const currentIn = inside(current)
    const previousIn = inside(previous)
    if (currentIn) {
      if (!previousIn) out.push(intersect(previous, current))
      out.push(current)
    } else if (previousIn) {
      out.push(intersect(previous, current))
    }
  }
  return out
}

export function clipToDepthSlab(view: Projector, poly: readonly Vec2[]): Vec2[] {
  const depth = (p: Vec2) => projectDepth(view, p[0], p[1])
  const cut =
    (limit: number, keepAbove: boolean) =>
    (a: Vec2, b: Vec2): Vec2 => {
      const da = depth(a)
      const db = depth(b)
      const t = Math.abs(db - da) < 1e-12 ? 0 : (limit - da) / (db - da)
      void keepAbove
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
  let result = clipHalfPlane(
    poly,
    (p) => depth(p) >= view.depthMin - 1e-9,
    cut(view.depthMin, true),
  )
  if (result.length < 3) return []
  result = clipHalfPlane(result, (p) => depth(p) <= view.depthMax + 1e-9, cut(view.depthMax, false))
  return result.length >= 3 ? result : []
}

// ---------------------------------------------------------------------------
// Projected (background) solids — painter's-order hidden-line removal.
//
// LIMIT, stated plainly: this is polygon-level HLR only. Each solid is drawn
// as an OPAQUE white silhouette with a stroked outline, back to front by its
// nearest depth. A nearer solid therefore hides a farther one, which is right
// for the overwhelmingly common case (a wall in front of a wall). What it does
// NOT do: split a farther solid's edges where a nearer one only partly covers
// it in depth (interpenetrating solids), and it cannot express a dashed hidden
// line. Two solids whose silhouettes overlap but whose depth order flips across
// that overlap are drawn in the wrong order. Real per-edge HLR (BSP or
// segment-vs-silhouette clipping) is the upgrade path.
// ---------------------------------------------------------------------------

export type ProjectedPiece = {
  /** Sort key — larger is farther and is drawn first. */
  depth: number
  primitives: FloorplanGeometry[]
}

function uExtent(view: Projector, poly: readonly Vec2[]): [number, number] | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const p of poly) {
    const u = projectU(view, p[0], p[1])
    if (u < min) min = u
    if (u > max) max = u
  }
  return Number.isFinite(min) && max - min > 1e-6 ? [min, max] : null
}

function maxDepth(view: Projector, poly: readonly Vec2[]): number {
  let max = Number.NEGATIVE_INFINITY
  for (const p of poly) max = Math.max(max, projectDepth(view, p[0], p[1]))
  return max
}

/** Openings drawn on a wall face that actually faces the viewer. */
function openingPrimitives(
  view: Projector,
  wall: WallSolid,
  opening: Opening,
  faceVisible: boolean,
): FloorplanGeometry[] {
  if (!faceVisible) return []
  const centre: Vec2 = [
    wall.start[0] + wall.axis[0] * opening.along,
    wall.start[1] + wall.axis[1] * opening.along,
  ]
  const half = opening.width / 2
  const u0 = projectU(view, centre[0] - wall.axis[0] * half, centre[1] - wall.axis[1] * half)
  const u1 = projectU(view, centre[0] + wall.axis[0] * half, centre[1] + wall.axis[1] * half)
  const [uMin, uMax] = u0 <= u1 ? [u0, u1] : [u1, u0]
  if (uMax - uMin < 1e-4) return []
  // The opening as the node describes it — sashes, leaves, panels, grids,
  // casing, sill, threshold (openings.ts). Cased openings draw no leaf.
  const box = { x0: uMin, x1: uMax, yTop: drawY(opening.headY), yBottom: drawY(opening.sillY) }
  return opening.nodeType === 'window' ? windowGlyph(opening, box) : doorGlyph(opening, box)
}

/** Drawing x of an opening's centre on `wall`, for tags. */
export function openingCentreU(view: Projector, wall: WallSolid, opening: Opening): number {
  return projectU(
    view,
    wall.start[0] + wall.axis[0] * opening.along,
    wall.start[1] + wall.axis[1] * opening.along,
  )
}

export { CASING }

export type ProjectWallOptions = {
  /**
   * Draw the assembly's cladding pattern on faces whose EXTERIOR side looks
   * at the viewer (elevations). Off for sections' background walls.
   */
  finish?: boolean
}

export function projectWall(
  view: Projector,
  wall: WallSolid,
  options: ProjectWallOptions = {},
): ProjectedPiece | null {
  const clipped = clipToDepthSlab(view, wall.polygon)
  const extent = uExtent(view, clipped)
  if (!extent) return null
  const facing = wall.normal[0] * view.forward[0] + wall.normal[1] * view.forward[1]
  const faceVisible = Math.abs(facing) > 0.3
  // The exterior face points AT the viewer when its outward normal runs
  // against the view direction.
  const exteriorFacesViewer = facing * wall.exteriorSign < -0.3
  // The face is painted in the cladding's own colour when the exterior looks
  // at the viewer and the material rendition is on; otherwise paper white.
  const clad = options.finish && exteriorFacesViewer
  const primitives: FloorplanGeometry[] = [
    polygonPrimitive(rectPolygon(extent[0], drawY(wall.topY), extent[1], drawY(wall.baseY)), {
      fill: clad ? (wall.claddingColor ?? PAPER) : PAPER,
      stroke: INK,
      strokeWidth: WEIGHT.projected,
    }),
  ]
  if (options.finish && exteriorFacesViewer && wall.exteriorFinish && wall.exteriorFinish !== 'none') {
    const holes: FaceHole[] = wall.openings.map((opening) => {
      const centre: Vec2 = [
        wall.start[0] + wall.axis[0] * opening.along,
        wall.start[1] + wall.axis[1] * opening.along,
      ]
      const half = opening.width / 2
      const u0 = projectU(view, centre[0] - wall.axis[0] * half, centre[1] - wall.axis[1] * half)
      const u1 = projectU(view, centre[0] + wall.axis[0] * half, centre[1] + wall.axis[1] * half)
      return { u: [u0, u1], y: [drawY(opening.headY), drawY(opening.sillY)] }
    })
    primitives.push(
      ...finishHatch(wall.exteriorFinish, extent, drawY(wall.topY), drawY(wall.baseY), holes),
    )
  }
  for (const opening of wall.openings) {
    primitives.push(...openingPrimitives(view, wall, opening, faceVisible))
  }
  return { depth: maxDepth(view, clipped), primitives }
}

export function projectPrism(view: Projector, prism: PrismSolid): ProjectedPiece | null {
  const clipped = clipToDepthSlab(view, prism.polygon)
  const extent = uExtent(view, clipped)
  if (!extent) return null
  return {
    depth: maxDepth(view, clipped),
    primitives: [
      polygonPrimitive(rectPolygon(extent[0], drawY(prism.topY), extent[1], drawY(prism.bottomY)), {
        fill: PAPER,
        stroke: INK,
        strokeWidth: prism.kind === 'slab' ? WEIGHT.projected : WEIGHT.detail,
      }),
    ],
  }
}

const ROOF_SAMPLES = 72
/** Roof covering colour when the roof carries no material: an assumed asphalt-shingle grey. */
export const ROOF_ASSUMED = '#9ca3af'

/**
 * Silhouette of a roof segment as seen by `view`: the upper envelope of its
 * top surface plus the lower envelope of its deck underside, sampled over the
 * segment's own local footprint and bucketed by drawing x.
 */
export type ProjectRoofOptions = {
  /** Draw shingle courses inside the roof silhouette (elevations). */
  courses?: boolean
  /** Colour of the walls' cladding, for a gable end seen head-on. */
  gableColor?: string | null
  /** Print the pitch flag (rise:12) on a slope seen from the gable end. */
  pitchFlag?: boolean
  /**
   * Cladding for a GABLE END seen head-on: the triangle under the rake is the
   * gable wall, not roof surface, so it takes the walls' finish pattern.
   * Absent → the gable is left blank.
   */
  gableFinish?: 'siding' | 'stucco' | 'brick' | 'stone' | 'fiber-cement' | 'none' | null
}

export function projectRoof(
  view: Projector,
  roof: RoofSolid,
  options: ProjectRoofOptions = {},
): ProjectedPiece | null {
  const clipped = clipToDepthSlab(view, roof.polygon)
  if (clipped.length < 3) return null
  const extent = uExtent(view, clipped)
  if (!extent) return null
  const [uMin, uMax] = extent
  const top = new Array<number>(ROOF_SAMPLES + 1).fill(Number.NEGATIVE_INFINITY)
  const bottom = new Array<number>(ROOF_SAMPLES + 1).fill(Number.POSITIVE_INFINITY)
  const stepX = (roof.local.maxX - roof.local.minX) / ROOF_SAMPLES
  const stepZ = (roof.local.maxZ - roof.local.minZ) / ROOF_SAMPLES
  for (let i = 0; i <= ROOF_SAMPLES; i++) {
    const lx = roof.local.minX + stepX * i
    for (let j = 0; j <= ROOF_SAMPLES; j++) {
      const lz = roof.local.minZ + stepZ * j
      const world = roof.toWorld(lx, lz)
      const depth = projectDepth(view, world[0], world[1])
      if (depth < view.depthMin - 1e-9 || depth > view.depthMax + 1e-9) continue
      const u = projectU(view, world[0], world[1])
      const bucket = Math.round(((u - uMin) / (uMax - uMin || 1)) * ROOF_SAMPLES)
      if (bucket < 0 || bucket > ROOF_SAMPLES) continue
      const surface = roof.originY + roof.surfaceY(lx, lz)
      if (surface > top[bucket]!) top[bucket] = surface
      const under = surface - roof.deckDrop
      if (under < bottom[bucket]!) bottom[bucket] = under
    }
  }
  const upper: Vec2[] = []
  const lower: Vec2[] = []
  for (let i = 0; i <= ROOF_SAMPLES; i++) {
    if (!Number.isFinite(top[i]!)) continue
    const u = uMin + ((uMax - uMin) * i) / ROOF_SAMPLES
    upper.push([u, drawY(top[i]!)])
    lower.push([u, drawY(bottom[i]!)])
  }
  if (upper.length < 2) return null
  const outline = [...upper, ...lower.reverse()]
  const halfDepth = (roof.local.maxZ - roof.local.minZ) / 2
  const rise = roof.ridgeY - roof.plateY
  // Which face is this? A slope face looks at the viewer when the segment's
  // down-slope axis runs along the view direction (the same test the fascia
  // line uses); a gable END is seen when the axis runs across it.
  const alignment = Math.abs(roof.axisZ[0] * view.forward[0] + roof.axisZ[1] * view.forward[1])
  const slopeFace = alignment > 0.7
  const gableEnd = alignment < 0.3 && rise > 0.05
  const fill = options.courses
    ? slopeFace
      ? (roof.color ?? ROOF_ASSUMED)
      : gableEnd
        ? (options.gableColor ?? PAPER)
        : PAPER
    : PAPER
  const primitives: FloorplanGeometry[] = [
    polygonPrimitive(outline, { fill, stroke: INK, strokeWidth: WEIGHT.projected }),
  ]
  if (options.pitchFlag && gableEnd && halfDepth > 1e-6) {
    // Pitch flag on the left slope: rise in twelfths over a 12-unit run, from
    // the segment's pitch angle — the same number the roof plan prints.
    const riseIn12 = Math.round(Math.tan((roof.pitchDeg * Math.PI) / 180) * 12 * 2) / 2
    const a = upper[0]!
    const b = upper[Math.max(1, Math.floor(upper.length * 0.25))]!
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2 - 0.35
    const run = 0.45
    const riseM = (run * riseIn12) / 12
    primitives.push(
      line([mx - run, my], [mx, my], { strokeWidth: WEIGHT.detail }),
      line([mx, my], [mx, my - riseM], { strokeWidth: WEIGHT.detail }),
      line([mx - run, my], [mx, my - riseM], { strokeWidth: WEIGHT.detail }),
      {
        kind: 'text',
        x: mx - run / 2,
        y: my + 0.14,
        text: '12',
        fontSize: 0.12,
        fill: INK,
        textAnchor: 'middle',
        dominantBaseline: 'alphabetic',
      } as FloorplanGeometry,
      {
        kind: 'text',
        x: mx + 0.06,
        y: my - riseM / 2 + 0.04,
        text: `${riseIn12}`,
        fontSize: 0.12,
        fill: INK,
        textAnchor: 'start',
        dominantBaseline: 'alphabetic',
      } as FloorplanGeometry,
    )
  }
  if (options.courses) {
    const plateY = drawY(roof.plateY)
    // The region between the silhouette's top edge and the plate line.
    const aboveWalls: Vec2[] = [...upper, [upper[upper.length - 1]![0], plateY], [upper[0]![0], plateY]]
    if (rise > 0.05 && alignment > 0.7) {
      // Shingle exposure foreshortened by the pitch: a course seen in
      // elevation is `exposure · cos(pitch)` tall.
      const cosPitch = halfDepth > 1e-6 ? halfDepth / Math.hypot(halfDepth, rise) : 1
      primitives.push(...scanlinesInPolygon(aboveWalls, SHINGLE_COURSE * cosPitch))
    } else if (rise > 0.05 && alignment < 0.3 && options.gableFinish) {
      // Gable end: the triangle is wall, clad like the walls below it.
      const finish = options.gableFinish
      if (finish === 'siding' || finish === 'fiber-cement') {
        primitives.push(...scanlinesInPolygon(aboveWalls, LAP_EXPOSURE))
      } else if (finish === 'brick') {
        primitives.push(...scanlinesInPolygon(aboveWalls, BRICK_COURSE, { strokeWidth: 0.0025 }))
      } else if (finish === 'stone') {
        primitives.push(...scanlinesInPolygon(aboveWalls, STONE_COURSE))
      }
      // stucco: the stipple is not clipped to a polygon here — left blank.
    }
  }
  return { depth: maxDepth(view, clipped), primitives }
}

export function paintProjected(pieces: ProjectedPiece[]): FloorplanGeometry[] {
  return pieces.sort((a, b) => b.depth - a.depth).flatMap((piece) => piece.primitives)
}

// ---------------------------------------------------------------------------
// Datums, grade
// ---------------------------------------------------------------------------

export function levelDatums(model: BuildingModel, uMin: number, uMax: number): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const overshoot = 0.45
  for (const level of model.levels) {
    const y = drawY(level.baseY)
    out.push(
      line([uMin - overshoot, y], [uMax + overshoot, y], {
        stroke: INK,
        strokeWidth: WEIGHT.datum,
        strokeDasharray: DASH.datum,
        opacity: 0.7,
      }),
    )
    out.push({
      kind: 'text',
      x: uMax + overshoot + 0.08,
      y: y + 0.05,
      text: `${level.ordinal === 0 ? 'FINISH FLOOR' : level.name.toUpperCase()}   ${formatFeetInches(level.baseY)}`,
      fontSize: 0.15,
      fill: INK,
      textAnchor: 'start',
      dominantBaseline: 'alphabetic',
    } as FloorplanGeometry)
  }
  return out
}

export function roofDatums(model: BuildingModel, uMin: number, uMax: number): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  const seen = new Set<string>()
  const overshoot = 0.45
  for (const roof of model.roofs) {
    for (const [name, elevation] of [
      ['T.O. PLATE', roof.plateY],
      ['RIDGE', roof.ridgeY],
    ] as const) {
      const key = `${name}:${elevation.toFixed(3)}`
      if (seen.has(key)) continue
      seen.add(key)
      const y = drawY(elevation)
      out.push(
        line([uMin - overshoot, y], [uMax + overshoot, y], {
          stroke: INK,
          strokeWidth: WEIGHT.datum,
          strokeDasharray: DASH.datum,
          opacity: 0.7,
        }),
      )
      out.push({
        kind: 'text',
        x: uMax + overshoot + 0.08,
        y: y + 0.05,
        text: `${name}   ${formatFeetInches(elevation)}`,
        fontSize: 0.15,
        fill: INK,
        textAnchor: 'start',
        dominantBaseline: 'alphabetic',
      } as FloorplanGeometry)
    }
  }
  return out
}

/**
 * Grade line sampled off the site terrain along the view's right axis, taken
 * at the depth of the building's own centre. Flat at level-0 elevation when
 * the scene has no terrain.
 */
export function gradeLine(
  model: BuildingModel,
  view: Projector,
  uMin: number,
  uMax: number,
  depthAt: number,
): { primitives: FloorplanGeometry[]; minElevation: number } {
  const samples = 96
  const points: Vec2[] = []
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i <= samples; i++) {
    const u = uMin + ((uMax - uMin) * i) / samples
    const x = view.origin[0] + view.right[0] * u + view.forward[0] * depthAt
    const z = view.origin[1] + view.right[1] * u + view.forward[1] * depthAt
    const elevation = model.gradeAt(x, z)
    min = Math.min(min, elevation)
    points.push([u, drawY(elevation)])
  }
  const first = points[0] as Vec2
  return {
    primitives: [
      polyline(points, { stroke: INK, strokeWidth: WEIGHT.cut }),
      ...gradeTicks(points),
      {
        kind: 'text',
        x: first[0] - 0.1,
        y: first[1] + 0.05,
        text: `GRADE   ${formatFeetInches(Number.isFinite(min) ? min : 0)}`,
        fontSize: 0.15,
        fill: INK,
        textAnchor: 'end',
        dominantBaseline: 'alphabetic',
      } as FloorplanGeometry,
    ],
    minElevation: Number.isFinite(min) ? min : 0,
  }
}

export function boundsFromPrimitives(primitives: readonly FloorplanGeometry[]) {
  const points: Vec2[] = []
  const walk = (g: FloorplanGeometry) => {
    switch (g.kind) {
      case 'polygon':
      case 'polyline':
        for (const p of g.points) points.push([p[0], p[1]])
        break
      case 'line':
        points.push([g.x1, g.y1], [g.x2, g.y2])
        break
      case 'rect':
        points.push([g.x, g.y], [g.x + g.width, g.y + g.height])
        break
      case 'circle':
        points.push([g.cx - g.r, g.cy - g.r], [g.cx + g.r, g.cy + g.r])
        break
      case 'text':
        points.push([g.x, g.y])
        break
      case 'group':
        for (const child of g.children) walk(child)
        break
      default:
        break
    }
  }
  for (const g of primitives) walk(g)
  return boundsOf(points)
}

export { POCHE_ROOF, segmentInsidePolygon }
