import type { AnyNode } from '../schema'
import type { RoofNode } from '../schema/nodes/roof'
import {
  getBarrelRoofSolidPieces,
  getGlazedRoofPieceFaces,
  getGlazedRoofPieces,
  isGlazedRoofSegment,
} from '../schema/nodes/roof-glazing'
import {
  getConicalRoofCoverage,
  getRoofSegmentDeckReach,
  getSegmentSlopeFrame,
  isBandedShedSegment,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'
import {
  getRoofModuleFaces,
  getRoofShapeInsets,
  getRoofShapeRatios,
  type RoofShapeFaceVertex,
} from '../schema/nodes/roof-segment-shape'
import { triangulatePlanPolygon } from './earcut'
import { clipRoofTrianglesByTrim, getRoofSegmentTrimCuts } from './roof-outline'
import {
  getShedBandFacetCount,
  getShedFootprintPieces,
  getShedRenderPieces,
} from './roof-shed-pieces'
import { bendShedBandPoint, getShedPieceSurface } from './roof-shed-surface'
import { getDutchRakeBoardTops, getRoofFasciaBoardFaces, wearsRoofFascia } from './roof-trim-faces'

type Point = [number, number, number]
export type RoofSurfaceTriangle = { vertices: [Point, Point, Point]; normal: Point }
export type RoofModuleInput = Parameters<typeof getRoofModuleFaces>[0]
export type RoofSurfacePatch = {
  triangles: RoofSurfaceTriangle[]
  sourcePieceIndex: number | null
  neighborIds: RoofSegmentNode['id'][]
}

/** Brush construction recipe only: independent coverings and custom sheds have their own dispatch. */
export function getRoofShingleModules(segment: RoofSegmentNode): {
  bottom: RoofModuleInput
  top: RoofModuleInput
  shiftZ: number
} {
  const { roofType, width, depth, wallHeight, deckThickness, shingleThickness } = segment
  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(segment)
  const reach = getRoofSegmentDeckReach(segment)
  const drop = reach.z * tanTheta
  const lip = shingleThickness * sinTheta
  const w = Math.max(0.01, width + 2 * reach.x)
  const d = Math.max(0.01, depth + 2 * reach.z)
  const wh = wallHeight - drop + (activeRh > 0 ? deckThickness / cosTheta : deckThickness)
  const rh = activeRh > 0 ? activeRh + (roofType === 'shed' ? 2 : 1) * drop : activeRh
  const availableR = (Math.min(w, d) / 2) * 0.95
  const maxDrop = tanTheta > 0.001 ? availableR / tanTheta : 2
  const coverage = getConicalRoofCoverage(segment)
  const bottom: RoofModuleInput = {
    type: roofType,
    w,
    d,
    wh,
    rh,
    baseY: wh - Math.min(2, maxDrop * 0.8),
    baseW: width,
    baseD: depth,
    insets: {},
    tanTheta,
    shapeRatios: getRoofShapeRatios(segment),
    dutchTopRakeThickness: segment.dutchTopRakeThickness,
    conicalStartAngle: coverage.startAngle,
    conicalSweepAngle: coverage.sweepAngle,
  }
  const bothAxes = ['hip', 'mansard', 'dutch', 'conical'].includes(roofType)
  const bothEaves = bothAxes || roofType === 'gable' || roofType === 'gambrel'
  const top: RoofModuleInput = {
    ...bottom,
    w: w + (bothAxes ? 2 * lip : 0),
    d: d + (bothEaves ? 2 * lip : roofType === 'shed' ? lip : 0),
    wh: wh + shingleThickness * cosTheta,
    rh: activeRh > 0 ? rh + lip * tanTheta : rh,
    baseY: wh - Math.min(1, maxDrop * 0.4),
  }
  for (const [module, isVoid] of [
    [bottom, true],
    [top, false],
  ] as const) {
    module.insets = getRoofShapeInsets({
      roofType,
      width,
      depth,
      wh: module.wh,
      baseY: module.baseY,
      isVoid,
      brushW: module.w,
      brushD: module.d,
      tanTheta,
      shingleThickness,
      dutchHipWidthRatio: segment.dutchHipWidthRatio,
    })
  }
  return { bottom, top, shiftZ: roofType === 'shed' ? lip / 2 : 0 }
}

function triangle(vertices: [Point, Point, Point], orient = false): RoofSurfaceTriangle | null {
  const [a, b, c] = vertices
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const normal: Point = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  const length = Math.hypot(...normal)
  if (!(length > 1e-12 && Number.isFinite(length))) return null
  if (orient && normal[1] < 0) {
    vertices = [c, b, a]
    for (let i = 0; i < 3; i++) normal[i]! *= -1
  }
  if (!(normal[1] > 0)) return null
  return { vertices, normal: [normal[0] / length, normal[1] / length, normal[2] / length] }
}

export function faceTriangles(
  faces: RoofShapeFaceVertex[][],
  shiftZ = 0,
  orient = false,
): RoofSurfaceTriangle[] {
  return faces.flatMap((face) => {
    const points = face.map((p): Point => [p.x, p.y, p.z + shiftZ])
    if (points.length < 3) return []
    // The renderer skips a whole face if its first three vertices are degenerate.
    const [a, b, c] = points as [Point, Point, Point, ...Point[]]
    const cross = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ]
    if (Math.hypot(...cross) === 0) return []
    return points.slice(1, -1).flatMap((p, i) => {
      const result = triangle([a, p, points[i + 2]!], orient)
      return result ? [result] : []
    })
  })
}

function shedPatches(
  segment: RoofSegmentNode,
  shell: boolean,
  nodes?: Readonly<Record<string, AnyNode>>,
): RoofSurfacePatch[] | null {
  if (segment.roofType !== 'shed') return null
  const pieces = getShedFootprintPieces(segment)
  const arc = isBandedShedSegment(segment) ? segment.arc : undefined
  if (!pieces.length && !arc) return null
  const point = (x: number, z: number, y: number): Point => {
    const bent = arc ? bendShedBandPoint(arc, x, z) : [x, z]
    return [bent[0]!, y, bent[1]!]
  }
  if (!pieces.length) {
    // The native un-pieced band uses a quad fan, not Earcut's opposite diagonal.
    const count = getShedBandFacetCount(segment.width)
    return Array.from({ length: count }, (_, index) => {
      const x0 = -segment.width / 2 + (index / count) * segment.width
      const x1 = -segment.width / 2 + ((index + 1) / count) * segment.width
      const z = segment.depth / 2
      const outline: [number, number][] = [
        [x0, z],
        [x1, z],
        [x1, -z],
        [x0, -z],
      ]
      const surface = getShedPieceSurface(segment, outline, nodes)
      const vertices = outline.map(([x, z], i) =>
        point(x, z, surface.topY[i]! - (shell ? surface.verticalThickness : 0)),
      )
      const triangles = [
        [0, 1, 2],
        [0, 2, 3],
      ].flatMap(([a, b, c]) => {
        const result = triangle([vertices[a!]!, vertices[b!]!, vertices[c!]!], true)
        return result ? [result] : []
      })
      return { triangles, sourcePieceIndex: null, neighborIds: [] }
    })
  }
  return getShedRenderPieces(segment).map(({ outline, sourcePieceIndex }) => {
    const surface = getShedPieceSurface(segment, outline, nodes)
    const vertices = outline.map(([x, z], i) =>
      point(x, z, surface.topY[i]! - (shell ? surface.verticalThickness : 0)),
    )
    const triangles = triangulatePlanPolygon(outline).flatMap(([a, b, c]) => {
      const result = triangle([vertices[a]!, vertices[b]!, vertices[c]!], true)
      return result ? [result] : []
    })
    const neighborIds =
      !arc && outline.length === 3 && nodes
        ? [
            ...new Set(
              surface.edgeSiblings.flatMap((sibling) => (sibling?.arc ? [sibling.id] : [])),
            ),
          ]
        : []
    return { triangles, sourcePieceIndex, neighborIds }
  })
}

function shedTriangles(
  segment: RoofSegmentNode,
  shell: boolean,
  nodes?: Readonly<Record<string, AnyNode>>,
): RoofSurfaceTriangle[] | null {
  return shedPatches(segment, shell, nodes)?.flatMap((patch) => patch.triangles) ?? null
}

/** Internal producer seam: retain construction identity before any query clipping. */
export function getRoofSegmentShellPatches(
  roof: RoofNode,
  segment: RoofSegmentNode,
  nodes: Readonly<Record<string, AnyNode>>,
): RoofSurfacePatch[] {
  if (!isGlazedRoofSegment(segment)) {
    const shed = shedPatches(segment, true, nodes)
    if (shed) return shed
  }
  return [
    {
      triangles: buildRoofSegmentShellTriangles(roof, segment, nodes),
      sourcePieceIndex: null,
      neighborIds: [],
    },
  ]
}

function conicalSectorTop(segment: RoofSegmentNode): RoofSurfaceTriangle[] | null {
  if (segment.roofType !== 'conical' || getRoofSegmentTrimCuts(segment).length) return null
  const coverage = getConicalRoofCoverage(segment)
  if (coverage.fullCircle) return null
  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(segment)
  const deckRadius =
    segment.width / 2 + segment.wallThickness / 2 + segment.overhang * Math.max(0, cosTheta)
  const radius = deckRadius + segment.shingleThickness * sinTheta
  const lift = segment.deckThickness / Math.max(0.1, cosTheta) + segment.shingleThickness * cosTheta
  const eave = segment.wallHeight - (deckRadius - segment.width / 2) * tanTheta + lift
  const peak = segment.wallHeight + activeRh + lift + segment.shingleThickness * sinTheta * tanTheta
  const count = Math.max(1, Math.ceil((48 * Math.abs(coverage.sweepAngle)) / (Math.PI * 2)))
  const ring = (index: number): Point => {
    const angle = coverage.startAngle + (index / count) * coverage.sweepAngle
    return [Math.cos(angle) * radius, eave, Math.sin(angle) * radius]
  }
  return Array.from({ length: count }, (_, i) => {
    const result = triangle([ring(i), ring(i + 1), [0, peak, 0]], true)
    return result ? [result] : []
  }).flat()
}

/** Native finished covering before accessory/plugin/inter-roof CSG; never a scene support verdict. */
export function buildRoofSegmentCoveringTriangles(
  roof: RoofNode,
  segment: RoofSegmentNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): RoofSurfaceTriangle[] {
  if (isGlazedRoofSegment(segment) || segment.roofType === 'barrel') {
    const pieces = isGlazedRoofSegment(segment)
      ? getGlazedRoofPieces(segment)
      : getBarrelRoofSolidPieces(segment)
    return clipRoofTrianglesByTrim(
      segment,
      // End-wall and frame solids can have upward-facing caps even when their host face is vertical.
      faceTriangles(pieces.flatMap(getGlazedRoofPieceFaces)),
    )
  }
  const shed = shedTriangles(segment, false, nodes)
  if (shed) return shed
  const cone = conicalSectorTop(segment)
  if (cone) return cone
  const { top, shiftZ } = getRoofShingleModules(segment)
  const faces = getRoofModuleFaces(top)
  if (segment.roofType === 'dutch' && top.insets.dutchI !== undefined)
    faces.push(
      ...getDutchRakeBoardTops({
        ...top,
        dutchI: top.insets.dutchI,
        thickness: segment.dutchTopRakeThickness,
      }),
    )
  const result = faceTriangles(faces, shiftZ)
  if (wearsRoofFascia(segment, roof, nodes))
    result.push(...faceTriangles(getRoofFasciaBoardFaces(segment)))
  return clipRoofTrianglesByTrim(segment, result)
}

/** Intersect a structural triangle with a convex support polygon in plan, retaining its plane. */
function maskTriangle(source: RoofSurfaceTriangle, mask: readonly Point[]): RoofSurfaceTriangle[] {
  let polygon: Point[] = source.vertices
  const area = mask.reduce((sum, a, i) => {
    const b = mask[(i + 1) % mask.length]!
    return sum + a[0] * b[2] - b[0] * a[2]
  }, 0)
  if (area === 0) return []
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]!
    const b = mask[(i + 1) % mask.length]!
    const signed = (p: Point) =>
      Math.sign(area) * ((b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]))
    const next: Point[] = []
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j]!
      const q = polygon[(j + 1) % polygon.length]!
      const dp = signed(p)
      const dq = signed(q)
      if (dp >= 0) next.push(p)
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq)
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])])
      }
    }
    polygon = next
    if (polygon.length < 3) return []
  }
  return polygon.slice(1, -1).flatMap((b, i) => {
    const result = triangle([polygon[0]!, b, polygon[i + 2]!])
    return result ? [result] : []
  })
}

/** Bare structural seating datum, not deck underside; native trim and covering gaps still apply. */
export function buildRoofSegmentShellTriangles(
  roof: RoofNode,
  segment: RoofSegmentNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): RoofSurfaceTriangle[] {
  if (isGlazedRoofSegment(segment) || segment.roofType === 'barrel') {
    const pieces = isGlazedRoofSegment(segment)
      ? getGlazedRoofPieces(segment)
      : getBarrelRoofSolidPieces(segment)
    const tops = faceTriangles(
      pieces.filter((p) => p.face.normal[1] > 0).map((p) => getGlazedRoofPieceFaces(p)[0]!),
    )
    const x = segment.width / 2
    const z = segment.depth / 2
    const bounds: Point[] = [
      [-x, 0, -z],
      [x, 0, -z],
      [x, 0, z],
      [-x, 0, z],
    ]
    return clipRoofTrianglesByTrim(
      segment,
      tops.flatMap((t) => maskTriangle(t, bounds)),
    )
  }
  const shed = shedTriangles(segment, true, nodes)
  if (shed) return shed
  const { activeRh, tanTheta } = getSegmentSlopeFrame(segment)
  const coverage = getConicalRoofCoverage(segment)
  const faces = getRoofModuleFaces({
    type: segment.roofType,
    w: segment.width,
    d: segment.depth,
    wh: segment.wallHeight,
    rh: activeRh,
    baseY: 0,
    insets: { dutchI: Math.min(segment.width, segment.depth) * segment.dutchHipWidthRatio },
    baseW: segment.width,
    baseD: segment.depth,
    tanTheta,
    shapeRatios: getRoofShapeRatios(segment),
    dutchTopRakeThickness: segment.dutchTopRakeThickness,
    conicalStartAngle: coverage.startAngle,
    conicalSweepAngle: coverage.sweepAngle,
  })
  const structural = clipRoofTrianglesByTrim(segment, faceTriangles(faces))
  const covering = buildRoofSegmentCoveringTriangles(roof, segment, nodes)
  return structural.flatMap((source) =>
    covering.flatMap((cover) => maskTriangle(source, cover.vertices)),
  )
}
