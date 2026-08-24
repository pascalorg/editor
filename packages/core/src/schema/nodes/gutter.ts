import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { normalizeRoofSegmentTrim, type RoofSegmentNode } from './roof-segment'
import { getRoofShapeEaveSides } from './roof-segment-shape'

const MIN_DEFAULT_GUTTER_LENGTH_M = 0.2
const DEFAULT_GUTTER_GENERATOR = 'default-gutter'
const AUTO_GUTTER_METADATA_KEY = 'autoGutter'

export const GUTTER_EAVE_TUCK_INWARD = 0.04
export const GUTTER_EAVE_TUCK_UP = 0.04
export type GutterEaveSide = '+X' | '-X' | '+Z' | '-Z'

export type GutterRun = {
  side: GutterEaveSide
  position: [number, number, number]
  rotation: number
  length: number
}

export type GutterEdgeExclusion = {
  side: GutterEaveSide
  from: number
  to: number
}

type Point2D = readonly [number, number]
type Interval = readonly [number, number]

// A single drop outlet drilled in the gutter floor. A gutter can carry
// several so a long run can split between multiple downspouts (each
// downspout links to one outlet via its `outletId`).
export const GutterOutlet = z.object({
  // Stable id the downspout references. Generated with `generateId('outlet')`.
  id: z.string(),
  // Position along the gutter length (gutter-local +X), signed from the
  // CENTER. The geometry clamps it inside the end caps at build time, so
  // a stored value that no longer fits just rides the nearest bound.
  offset: z.number().default(0),
  // Bore diameter of this drop. Default 0.07 m ≈ 3″. The cross-section
  // SHAPE (round vs rectangular) follows the gutter's profile, not this.
  diameter: z.number().default(0.07),
  generatedBy: z.literal('default-downspout').optional(),
})
export type GutterOutlet = z.infer<typeof GutterOutlet>

export const GutterNode = BaseNode.extend({
  id: objectId('gutter'),
  type: nodeType('gutter'),

  material: MaterialSchema.optional(),
  slots: z.record(z.string(), z.string()).optional(),
  // White preset by default — matches the rest of the roof accessory
  // family (box-vent / ridge-vent) so the paint inspector reads as
  // "White" instead of "no material" on a freshly-placed gutter.
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  // Segment-local. The placement tool snaps to the eave line (Z =
  // +depth/2, Y = wallHeight) of the segment under the cursor; X is
  // wherever the user clicked. After placement the inspector + length
  // handles can shift X along the eave.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around the gutter's own local Y. Kept at 0 by default
  // because the gutter's length axis is constrained to the eave
  // direction (segment-local +X) — but exposed in case the user wants
  // to tilt for a custom run.
  rotation: z.number().default(0),

  // Length along the eave (gutter-local +X). For a curved eave this is the
  // arc length of the run.
  length: z.number().default(2.0),
  // Concentric-arc descriptor for a run that follows a curved eave, in
  // gutter-mesh-local coordinates (center + true radius). Absent for a straight
  // gutter.
  arc: z
    .object({
      centerX: z.number(),
      centerZ: z.number(),
      radius: z.number(),
    })
    .optional(),
  // Profile size — the vertical drop of the U-channel below the eave
  // line. 5″ (0.127 m) is the most common residential gutter size; 6″
  // (0.152 m) is the common commercial / heavy-duty size. Default
  // rounds the residential value to 0.13 m.
  size: z.number().default(0.13),
  // Wall thickness of the U-channel. Visible on the rim from above; too
  // thin reads as a paper strip, too thick reads as a curb.
  thickness: z.number().default(0.006),

  profile: z.enum(['k-style', 'half-round', 'box']).default('k-style'),

  // End caps close the open ends of the U-channel so water can't run
  // out the sides. Independent per-end because a downspout typically
  // joins the gutter at one end while the other stays capped. Default
  // true on both — matches a freshly-installed residential gutter.
  endCapLeft: z.boolean().default(true),
  endCapRight: z.boolean().default(true),

  // Hangers are the metal straps that hold the gutter onto the
  // fascia. 'strap' renders periodic bars across the rim; 'none'
  // hides them (some plastic gutters use hidden clips). Spacing is
  // metres between hanger centers; real residential code is roughly
  // 0.6 m for snow-load areas, 0.75 m elsewhere.
  hangerStyle: z.enum(['strap', 'none']).default('strap'),
  hangerSpacing: z.number().default(0.6),

  // Downspout outlets — short drop tubes descending from the gutter
  // floor where downspouts connect. Empty by default so existing
  // gutters don't sprout outlets on schema upgrade. Each is drilled
  // through the trough floor via CSG; a downspout links to one by id.
  outlets: z.array(GutterOutlet).default([]),
}).describe(
  dedent`
  Gutter — a rain-water channel running along the eave of a roof
  segment. Parented to a roof-segment; position is segment-local.
  - length: span along the eave (gutter-local +X)
  - size:   profile drop below the eave line (vertical extent)
  - profile: k-style (ogee fascia), half-round, or square box
  - endCapLeft / endCapRight: close the trough at gutter-local -X / +X
  - hangerStyle / hangerSpacing: visible metal straps across the rim
  - outlets: drop-tube outlets (id + along-length offset + bore diameter)
  `,
)

export type GutterNode = z.infer<typeof GutterNode>

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>
  }
  return {}
}

export function computeGutterEaveY(
  segment: Pick<RoofSegmentNode, 'wallHeight' | 'overhang' | 'pitch' | 'roofType'>,
): number {
  const wallHeight = segment.wallHeight ?? 0
  if ((segment.roofType ?? 'gable') === 'flat') return wallHeight
  const pitchRad = ((segment.pitch ?? 0) * Math.PI) / 180
  return wallHeight - (segment.overhang ?? 0) * Math.tan(pitchRad) + GUTTER_EAVE_TUCK_UP
}

function getDefaultGutterSides(segment: RoofSegmentNode): GutterEaveSide[] {
  return getRoofShapeEaveSides(segment.roofType)
}

function getGutterEnvelope(segment: RoofSegmentNode) {
  const halfW = Math.max(0, segment.width) / 2
  const halfD = Math.max(0, segment.depth) / 2
  const overhang = Math.max(0, segment.overhang ?? 0)
  const outerHalfW = Math.max(halfW, halfW + overhang - GUTTER_EAVE_TUCK_INWARD)
  const outerHalfD = Math.max(halfD, halfD + overhang - GUTTER_EAVE_TUCK_INWARD)
  const trim = normalizeRoofSegmentTrim(segment)
  const minX = trim.left > 0 ? -halfW + trim.left : -outerHalfW
  const maxX = trim.right > 0 ? halfW - trim.right : outerHalfW
  const minZ = trim.back > 0 ? -halfD + trim.back : -outerHalfD
  const maxZ = trim.front > 0 ? halfD - trim.front : outerHalfD

  return { minX, maxX, minZ, maxZ, outerHalfW, outerHalfD, trim }
}

function getGutterEnvelopePolygon(segment: RoofSegmentNode): Point2D[] {
  const { minX, maxX, minZ, maxZ, trim } = getGutterEnvelope(segment)
  return [
    [minX + trim.backLeftX, minZ],
    [maxX - trim.backRightX, minZ],
    [maxX, minZ + trim.backRightZ],
    [maxX, maxZ - trim.frontRightZ],
    [maxX - trim.frontRightX, maxZ],
    [minX + trim.frontLeftX, maxZ],
    [minX, maxZ - trim.frontLeftZ],
    [minX, minZ + trim.backLeftZ],
  ]
}

function segmentLocalToRoof(segment: RoofSegmentNode, point: Point2D): Point2D {
  const rotation = segment.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [
    (segment.position?.[0] ?? 0) + point[0] * cos + point[1] * sin,
    (segment.position?.[2] ?? 0) - point[0] * sin + point[1] * cos,
  ]
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D): boolean {
  const lengthSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  if (lengthSq <= 1e-14) {
    return (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2 <= 1e-14
  }
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0])
  if (Math.abs(cross) > 1e-7) return false
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])
  if (dot < -1e-7) return false
  return dot <= lengthSq + 1e-7
}

function pointStrictlyInsidePolygon(point: Point2D, polygon: readonly Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j] as Point2D
    const b = polygon[i] as Point2D
    if (pointOnSegment(point, a, b)) return false
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function segmentCrossingT(start: Point2D, end: Point2D, a: Point2D, b: Point2D) {
  const rx = end[0] - start[0]
  const rz = end[1] - start[1]
  const sx = b[0] - a[0]
  const sz = b[1] - a[1]
  const denominator = rx * sz - rz * sx
  if (Math.abs(denominator) < 1e-10) return null
  const dx = a[0] - start[0]
  const dz = a[1] - start[1]
  const t = (dx * sz - dz * sx) / denominator
  const u = (dx * rz - dz * rx) / denominator
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null
  return Math.max(0, Math.min(1, t))
}

function coveredIntervals(start: Point2D, end: Point2D, polygon: readonly Point2D[]): Interval[] {
  const splits = [0, 1]
  for (let i = 0; i < polygon.length; i++) {
    const t = segmentCrossingT(
      start,
      end,
      polygon[i] as Point2D,
      polygon[(i + 1) % polygon.length]!,
    )
    if (t !== null) splits.push(t)
  }
  splits.sort((a, b) => a - b)

  const unique = splits.filter((value, index) => index === 0 || value - splits[index - 1]! > 1e-7)
  const intervals: Interval[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    const from = unique[i]!
    const to = unique[i + 1]!
    if (to - from <= 1e-7) continue
    const middle = (from + to) / 2
    const point: Point2D = [
      start[0] + (end[0] - start[0]) * middle,
      start[1] + (end[1] - start[1]) * middle,
    ]
    if (pointStrictlyInsidePolygon(point, polygon)) intervals.push([from, to])
  }
  return intervals
}

function subtractInterval(visible: readonly Interval[], covered: Interval): Interval[] {
  const next: Interval[] = []
  for (const [from, to] of visible) {
    if (covered[1] <= from + 1e-7 || covered[0] >= to - 1e-7) {
      next.push([from, to])
      continue
    }
    if (covered[0] > from + 1e-7) next.push([from, Math.min(to, covered[0])])
    if (covered[1] < to - 1e-7) next.push([Math.max(from, covered[1]), to])
  }
  return next
}

function clipRunAgainstSegments(
  run: GutterRun,
  segment: RoofSegmentNode,
  roofSegments: readonly RoofSegmentNode[],
): GutterRun[] {
  const direction: Point2D = [Math.cos(run.rotation), -Math.sin(run.rotation)]
  const localStart: Point2D = [
    run.position[0] - direction[0] * (run.length / 2),
    run.position[2] - direction[1] * (run.length / 2),
  ]
  const localEnd: Point2D = [
    run.position[0] + direction[0] * (run.length / 2),
    run.position[2] + direction[1] * (run.length / 2),
  ]
  const roofStart = segmentLocalToRoof(segment, localStart)
  const roofEnd = segmentLocalToRoof(segment, localEnd)
  let visible: Interval[] = [[0, 1]]

  for (const sibling of roofSegments) {
    if (sibling.id === segment.id) continue
    const polygon = getGutterEnvelopePolygon(sibling).map((point) =>
      segmentLocalToRoof(sibling, point),
    )
    for (const covered of coveredIntervals(roofStart, roofEnd, polygon)) {
      visible = subtractInterval(visible, covered)
    }
    if (visible.length === 0) break
  }

  return visible
    .map(([from, to]) => {
      const length = run.length * (to - from)
      const middle = (from + to) / 2
      return {
        ...run,
        position: [
          localStart[0] + (localEnd[0] - localStart[0]) * middle,
          run.position[1],
          localStart[1] + (localEnd[1] - localStart[1]) * middle,
        ] as [number, number, number],
        length,
      }
    })
    .filter((candidate) => candidate.length >= MIN_DEFAULT_GUTTER_LENGTH_M)
}

function clipRunAgainstExclusions(
  run: GutterRun,
  exclusions: readonly GutterEdgeExclusion[],
): GutterRun[] {
  let visible: Interval[] = [[0, 1]]
  for (const exclusion of exclusions) {
    if (exclusion.side !== run.side) continue
    const from = Math.max(0, Math.min(1, Math.min(exclusion.from, exclusion.to)))
    const to = Math.max(0, Math.min(1, Math.max(exclusion.from, exclusion.to)))
    visible = subtractInterval(visible, [from, to])
    if (visible.length === 0) break
  }

  const direction: Point2D = [Math.cos(run.rotation), -Math.sin(run.rotation)]
  const start: Point2D = [
    run.position[0] - direction[0] * (run.length / 2),
    run.position[2] - direction[1] * (run.length / 2),
  ]
  return visible
    .map(([from, to]) => {
      const length = run.length * (to - from)
      const middle = (from + to) / 2
      return {
        ...run,
        position: [
          start[0] + direction[0] * run.length * middle,
          run.position[1],
          start[1] + direction[1] * run.length * middle,
        ] as [number, number, number],
        length,
      }
    })
    .filter((candidate) => candidate.length >= MIN_DEFAULT_GUTTER_LENGTH_M)
}

export function getGutterRunsForSegment(
  segment: RoofSegmentNode,
  roofSegments: readonly RoofSegmentNode[] = [],
  exclusions: readonly GutterEdgeExclusion[] = [],
): GutterRun[] {
  const { minX, maxX, minZ, maxZ, outerHalfW, outerHalfD, trim } = getGutterEnvelope(segment)
  const eaveY = computeGutterEaveY(segment)

  const runs: Record<GutterEaveSide, GutterRun | null> = {
    '+Z':
      trim.front > 0
        ? null
        : {
            side: '+Z',
            position: [(minX + maxX) / 2, eaveY, outerHalfD],
            rotation: 0,
            length: maxX - minX,
          },
    '-Z':
      trim.back > 0
        ? null
        : {
            side: '-Z',
            position: [(minX + maxX) / 2, eaveY, -outerHalfD],
            rotation: Math.PI,
            length: maxX - minX,
          },
    '+X':
      trim.right > 0
        ? null
        : {
            side: '+X',
            position: [outerHalfW, eaveY, (minZ + maxZ) / 2],
            rotation: Math.PI / 2,
            length: maxZ - minZ,
          },
    '-X':
      trim.left > 0
        ? null
        : {
            side: '-X',
            position: [-outerHalfW, eaveY, (minZ + maxZ) / 2],
            rotation: -Math.PI / 2,
            length: maxZ - minZ,
          },
  }

  const candidates = getDefaultGutterSides(segment)
    .map((side) => runs[side])
    .filter((run): run is GutterRun => run !== null && run.length >= MIN_DEFAULT_GUTTER_LENGTH_M)

  return candidates
    .flatMap((run) => clipRunAgainstExclusions(run, exclusions))
    .flatMap((run) => clipRunAgainstSegments(run, segment, roofSegments))
}

export function createDefaultGuttersForSegment(
  segment: RoofSegmentNode,
  roofSegments: readonly RoofSegmentNode[] = [],
  exclusions: readonly GutterEdgeExclusion[] = [],
): GutterNode[] {
  return getGutterRunsForSegment(segment, roofSegments, exclusions).map((run) =>
    GutterNode.parse({
      name: 'Gutter',
      roofSegmentId: segment.id,
      position: run.position,
      rotation: run.rotation,
      length: run.length,
      metadata: {
        generatedBy: DEFAULT_GUTTER_GENERATOR,
        autoGutterSide: run.side,
      },
    }),
  )
}

export function getDefaultGutterSide(
  node: unknown,
  roofSegmentId?: RoofSegmentNode['id'],
): GutterEaveSide | null {
  const parsed = GutterNode.safeParse(node)
  if (!parsed.success) return null
  if (roofSegmentId && parsed.data.roofSegmentId !== roofSegmentId) return null
  const metadata = metadataRecord(parsed.data.metadata)
  if (metadata.generatedBy !== DEFAULT_GUTTER_GENERATOR) return null
  const side = metadata.autoGutterSide
  return side === '+X' || side === '-X' || side === '+Z' || side === '-Z' ? side : null
}

export function isDefaultGutterNode(
  node: unknown,
  roofSegmentId?: RoofSegmentNode['id'],
): node is GutterNode {
  return getDefaultGutterSide(node, roofSegmentId) !== null
}

export function hasAutoGutterMetadata(segment: Pick<RoofSegmentNode, 'metadata'>): segment is Pick<
  RoofSegmentNode,
  'metadata'
> & {
  metadata: Record<string, unknown> & { autoGutter: boolean }
} {
  return typeof metadataRecord(segment.metadata)[AUTO_GUTTER_METADATA_KEY] === 'boolean'
}

export function isAutoGutterEnabled(
  segment: Pick<RoofSegmentNode, 'id' | 'children' | 'metadata'>,
  nodes?: Record<string, unknown>,
): boolean {
  const metadataValue = metadataRecord(segment.metadata)[AUTO_GUTTER_METADATA_KEY]
  if (typeof metadataValue === 'boolean') return metadataValue
  if (!nodes) return false
  return (segment.children ?? []).some((childId) => isDefaultGutterNode(nodes[childId], segment.id))
}
