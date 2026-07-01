import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import {
  getDutchRoofMetrics,
  getRoofSegmentVisibleTopBounds,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
  type RoofSegmentTrim,
} from './roof-segment'

const MIN_DEFAULT_RIDGE_VENT_LENGTH_M = 0.4
const DEFAULT_RIDGE_VENT_GENERATOR = 'default-ridge-vent'
const AUTO_RIDGE_VENT_METADATA_KEY = 'autoRidgeVent'
const LEGACY_DEFAULT_RIDGE_VENT_PRESET = 'preset-white'
const UNTRIMMED_RIDGE_VENT_BOUNDS_TRIM: RoofSegmentTrim = {
  left: 0,
  right: 0,
  front: 0,
  back: 0,
  frontLeft: 0,
  frontRight: 0,
  backLeft: 0,
  backRight: 0,
  frontLeftX: 0,
  frontLeftZ: 0,
  frontRightX: 0,
  frontRightZ: 0,
  backLeftX: 0,
  backLeftZ: 0,
  backRightX: 0,
  backRightZ: 0,
}

export type RidgeVentLine = {
  name: string
  start: [number, number]
  end: [number, number]
}

export const RidgeVentNode = BaseNode.extend({
  id: objectId('rvent'),
  type: nodeType('ridge-vent'),

  material: MaterialSchema.optional(),
  // Unpainted ridge vents inherit the roof top material in the renderer.
  materialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  length: z.number().default(2.0),
  width: z.number().default(0.3),
  // Taller default than the old paper-thin shell so the solid body reads
  // with real presence on the ridge; still adjustable down to 0.03.
  height: z.number().default(0.1),

  style: z.enum(['standard', 'shingled', 'metal']).default('standard'),
  endCaps: z.boolean().default(true),
}).describe(
  dedent`
  Ridge vent — a ventilation strip that sits along the ridge (peak) of a
  roof segment. Parented to a roof-segment; position is segment-local.
  - length: extent along the ridge
  - width: vent width straddling the ridge center
  - height: profile height above the ridge surface
  - style: standard (curved cap) / shingled / metal
  - endCaps: cap both ends or leave open
  `,
)

export type RidgeVentNode = z.infer<typeof RidgeVentNode>

export function getRidgeVentLinesForSegment(segment: RoofSegmentNode): RidgeVentLine[] {
  const bounds = getRoofSegmentVisibleTopBounds({
    ...segment,
    trim: UNTRIMMED_RIDGE_VENT_BOUNDS_TRIM,
  })
  const { width, depth, minX, maxX, minZ, maxZ } = bounds
  if (segment.roofType === 'flat' || segment.roofType === 'shed') return []

  const halfW = width / 2
  const halfD = depth / 2
  const ridgeZVisible = minZ <= 0 && maxZ >= 0
  const ridgeXVisible = minX <= 0 && maxX >= 0

  if (segment.roofType === 'mansard') {
    const inset = Math.min(
      Math.min(width, depth) *
        (segment.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio),
      Math.max(0, Math.min(width, depth) / 2 - 0.01),
    )
    const shoulderMinX = minX + inset
    const shoulderMaxX = maxX - inset
    const shoulderMinZ = minZ + inset
    const shoulderMaxZ = maxZ - inset
    const topW = Math.max(0, shoulderMaxX - shoulderMinX)
    const topD = Math.max(0, shoulderMaxZ - shoulderMinZ)
    const lowerSlopeLines: RidgeVentLine[] = [
      {
        name: 'Slope Ridge Vent',
        start: [shoulderMinX, shoulderMaxZ],
        end: [minX, maxZ],
      },
      {
        name: 'Slope Ridge Vent',
        start: [shoulderMaxX, shoulderMaxZ],
        end: [maxX, maxZ],
      },
      {
        name: 'Slope Ridge Vent',
        start: [shoulderMaxX, shoulderMinZ],
        end: [maxX, minZ],
      },
      {
        name: 'Slope Ridge Vent',
        start: [shoulderMinX, shoulderMinZ],
        end: [minX, minZ],
      },
    ]

    if (topW >= topD) {
      const leftRidge: [number, number] = [shoulderMinX + topD / 2, 0]
      const rightRidge: [number, number] = [shoulderMaxX - topD / 2, 0]
      return [
        ...(ridgeZVisible ? [{ name: 'Ridge Vent', start: leftRidge, end: rightRidge }] : []),
        { name: 'Hip Ridge Vent', start: [shoulderMinX, shoulderMaxZ], end: leftRidge },
        { name: 'Hip Ridge Vent', start: [shoulderMinX, shoulderMinZ], end: leftRidge },
        { name: 'Hip Ridge Vent', start: [shoulderMaxX, shoulderMaxZ], end: rightRidge },
        { name: 'Hip Ridge Vent', start: [shoulderMaxX, shoulderMinZ], end: rightRidge },
        ...lowerSlopeLines,
      ]
    }

    const frontRidge: [number, number] = [0, shoulderMaxZ - topW / 2]
    const backRidge: [number, number] = [0, shoulderMinZ + topW / 2]
    return [
      ...(ridgeXVisible ? [{ name: 'Ridge Vent', start: frontRidge, end: backRidge }] : []),
      { name: 'Hip Ridge Vent', start: [shoulderMinX, shoulderMaxZ], end: frontRidge },
      { name: 'Hip Ridge Vent', start: [shoulderMaxX, shoulderMaxZ], end: frontRidge },
      { name: 'Hip Ridge Vent', start: [shoulderMinX, shoulderMinZ], end: backRidge },
      { name: 'Hip Ridge Vent', start: [shoulderMaxX, shoulderMinZ], end: backRidge },
      ...lowerSlopeLines,
    ]
  }

  if (segment.roofType === 'dutch') {
    const { axis, inset } = getDutchRoofMetrics(segment)
    // The rendered hip arris and waist come from the EXPANDED (overhang +
    // shingle) rectangle — the same dims the eave corners below use — while
    // the inset is base-derived (matches getDutchRoofMetrics / the brush
    // builder). Deriving the waist from `getDutchRoofMetrics`' own base-dim
    // half-spans would tilt the hip lines off the arris on any roof with
    // overhang, sinking the vents into the slope. Mirror the mansard branch:
    // one coordinate system (expanded bounds) for both eave and waist.
    const waistLengthRatio =
      segment.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio
    const waistHalfX =
      axis === 'x' ? Math.max(0, (halfW - inset) * waistLengthRatio) : Math.max(0, halfW - inset)
    const waistHalfZ =
      axis === 'x' ? Math.max(0, halfD - inset) : Math.max(0, (halfD - inset) * waistLengthRatio)
    if (!(waistHalfX > 0.001 && waistHalfZ > 0.001)) return []

    // Dutch lower hip vents should terminate where the lower slope actually
    // meets the gablet rake, not at the inner waist line of the upper gable
    // triangle. Mirror the rendered roof shell's "outer waist" cap with the
    // same expanded-bounds frame we use for the eave corners above.
    const rake = segment.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake
    const rakeReach =
      axis === 'x'
        ? Math.min(Math.max(0, rake), Math.max(0, halfW - waistHalfX) * 0.98)
        : Math.min(Math.max(0, rake), Math.max(0, halfD - waistHalfZ) * 0.98)
    const rakeEndHalfX = axis === 'x' ? waistHalfX + rakeReach : waistHalfX
    const rakeEndHalfZ = axis === 'x' ? waistHalfZ : waistHalfZ + rakeReach

    const mainRidgeVisible = axis === 'x' ? ridgeZVisible : ridgeXVisible
    const ridgeStart: [number, number] = axis === 'x' ? [-rakeEndHalfX, 0] : [0, rakeEndHalfZ]
    const ridgeEnd: [number, number] = axis === 'x' ? [rakeEndHalfX, 0] : [0, -rakeEndHalfZ]
    return [
      ...(mainRidgeVisible ? [{ name: 'Ridge Vent', start: ridgeStart, end: ridgeEnd }] : []),
      { name: 'Hip Ridge Vent', start: [minX, maxZ], end: [-rakeEndHalfX, rakeEndHalfZ] },
      { name: 'Hip Ridge Vent', start: [maxX, maxZ], end: [rakeEndHalfX, rakeEndHalfZ] },
      { name: 'Hip Ridge Vent', start: [maxX, minZ], end: [rakeEndHalfX, -rakeEndHalfZ] },
      { name: 'Hip Ridge Vent', start: [minX, minZ], end: [-rakeEndHalfX, -rakeEndHalfZ] },
    ]
  }

  if (segment.roofType !== 'hip') {
    if (!ridgeZVisible) return []
    return [
      {
        name: 'Ridge Vent',
        start: [minX, 0],
        end: [maxX, 0],
      },
    ]
  }

  if (width >= depth) {
    const leftRidge: [number, number] = [minX + halfD, 0]
    const rightRidge: [number, number] = [maxX - halfD, 0]
    return [
      ...(ridgeZVisible ? [{ name: 'Ridge Vent', start: leftRidge, end: rightRidge }] : []),
      { name: 'Hip Ridge Vent', start: [minX, maxZ], end: leftRidge },
      { name: 'Hip Ridge Vent', start: [minX, minZ], end: leftRidge },
      { name: 'Hip Ridge Vent', start: [maxX, maxZ], end: rightRidge },
      { name: 'Hip Ridge Vent', start: [maxX, minZ], end: rightRidge },
    ]
  }

  const frontRidge: [number, number] = [0, maxZ - halfW]
  const backRidge: [number, number] = [0, minZ + halfW]
  return [
    ...(ridgeXVisible ? [{ name: 'Ridge Vent', start: frontRidge, end: backRidge }] : []),
    { name: 'Hip Ridge Vent', start: [minX, maxZ], end: frontRidge },
    { name: 'Hip Ridge Vent', start: [maxX, maxZ], end: frontRidge },
    { name: 'Hip Ridge Vent', start: [minX, minZ], end: backRidge },
    { name: 'Hip Ridge Vent', start: [maxX, minZ], end: backRidge },
  ]
}

function getLineYaw(start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  return Math.atan2(-dz, dx)
}

export function createDefaultRidgeVentsForSegment(segment: RoofSegmentNode): RidgeVentNode[] {
  return getRidgeVentLinesForSegment(segment)
    .map((line) => {
      const length = Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1])
      if (length < MIN_DEFAULT_RIDGE_VENT_LENGTH_M) return null

      return RidgeVentNode.parse({
        name: line.name,
        roofSegmentId: segment.id,
        position: [(line.start[0] + line.end[0]) / 2, 0, (line.start[1] + line.end[1]) / 2],
        rotation: getLineYaw(line.start, line.end),
        length,
        style: 'shingled',
        metadata: { generatedBy: DEFAULT_RIDGE_VENT_GENERATOR },
      })
    })
    .filter((vent): vent is RidgeVentNode => vent !== null)
}

export function isDefaultRidgeVentNode(
  node: unknown,
  roofSegmentId?: RoofSegmentNode['id'],
): node is RidgeVentNode {
  const parsed = RidgeVentNode.safeParse(node)
  if (!parsed.success) return false
  const vent = parsed.data
  if (roofSegmentId && vent.roofSegmentId !== roofSegmentId) return false
  const metadata = vent.metadata
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as Record<string, unknown>).generatedBy === DEFAULT_RIDGE_VENT_GENERATOR
  ) {
    return true
  }

  const hasDefaultName =
    vent.name === 'Ridge Vent' ||
    vent.name === 'Hip Ridge Vent' ||
    vent.name === 'Shoulder Ridge Vent' ||
    vent.name === 'Slope Ridge Vent'
  return (
    hasDefaultName &&
    vent.style === 'shingled' &&
    vent.material === undefined &&
    vent.materialPreset === LEGACY_DEFAULT_RIDGE_VENT_PRESET
  )
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>
  }
  return {}
}

export function hasAutoRidgeVentMetadata(
  segment: Pick<RoofSegmentNode, 'metadata'>,
): segment is Pick<RoofSegmentNode, 'metadata'> & {
  metadata: Record<string, unknown> & { autoRidgeVent: boolean }
} {
  return typeof metadataRecord(segment.metadata)[AUTO_RIDGE_VENT_METADATA_KEY] === 'boolean'
}

export function isAutoRidgeVentEnabled(
  segment: Pick<RoofSegmentNode, 'id' | 'children' | 'metadata'>,
  nodes?: Record<string, unknown>,
): boolean {
  const metadataValue = metadataRecord(segment.metadata)[AUTO_RIDGE_VENT_METADATA_KEY]
  if (typeof metadataValue === 'boolean') {
    return metadataValue
  }

  if (!nodes) return false
  return (segment.children ?? []).some((childId) =>
    isDefaultRidgeVentNode(nodes[childId], segment.id),
  )
}
