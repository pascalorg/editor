import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import type { MaterialSchema as MaterialSchemaType } from '../material'
import { MaterialSchema } from '../material'

export const RoofType = z.enum(['hip', 'gable', 'shed', 'gambrel', 'dutch', 'mansard', 'flat'])

export type RoofType = z.infer<typeof RoofType>

export const MIN_ROOF_SEGMENT_TRIM_SPAN = 0.1
const DEFAULT_ROOF_SEGMENT_WIDTH = 8
const DEFAULT_ROOF_SEGMENT_DEPTH = 6

export const RoofSegmentTrim = z
  .object({
    left: z.number().min(0).default(0),
    right: z.number().min(0).default(0),
    front: z.number().min(0).default(0),
    back: z.number().min(0).default(0),
    frontLeft: z.number().min(0).default(0),
    frontRight: z.number().min(0).default(0),
    backLeft: z.number().min(0).default(0),
    backRight: z.number().min(0).default(0),
    frontLeftX: z.number().min(0).default(0),
    frontLeftZ: z.number().min(0).default(0),
    frontRightX: z.number().min(0).default(0),
    frontRightZ: z.number().min(0).default(0),
    backLeftX: z.number().min(0).default(0),
    backLeftZ: z.number().min(0).default(0),
    backRightX: z.number().min(0).default(0),
    backRightZ: z.number().min(0).default(0),
  })
  .default({
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
  })

export type RoofSegmentTrim = z.infer<typeof RoofSegmentTrim>

// Default shape ratios. Tuning these used to require editing the geometry
// code in two places; they are now schema fields with these defaults.
export const ROOF_SHAPE_DEFAULTS = {
  /** Gambrel: lower (steep) face occupies this fraction of the horizontal half-depth. */
  gambrelLowerWidthRatio: 0.5,
  /** Gambrel: lower (steep) face rises this fraction of the way to the peak. */
  gambrelLowerHeightRatio: 0.6,
  /** Mansard: steep face occupies this fraction of `min(width, depth)`. */
  mansardSteepWidthRatio: 0.15,
  /** Mansard: steep face rises this fraction of the way to the peak. */
  mansardSteepHeightRatio: 0.7,
  /** Dutch: hip face occupies this fraction of `min(width, depth)`. */
  dutchHipWidthRatio: 0.25,
  /** Dutch: hip face rises this fraction of the way to the peak. */
  dutchHipHeightRatio: 0.5,
  /** Dutch: gable waist span along the ridge axis, as a fraction of the max span. */
  dutchWaistLengthRatio: 0.98,
  /**
   * Dutch: how far the gablet's barge board extends outward past the gablet
   * end-wall, along the ridge axis, in metres. 0 disables the rake. The board
   * lies in the gablet's slope planes (coplanar with the main Dutch slopes)
   * and overhangs the lower hip skirt; the gablet end-wall itself stays put.
   */
  dutchGabletRake: 0.48,
  /** Dutch: thickness of the top gable rake slab. */
  dutchTopRakeThickness: 0.21,
} as const

export const RoofSegmentNode = BaseNode.extend({
  id: objectId('rseg'),
  type: nodeType('roof-segment'),
  // Catch-all material — splatted across all 4 slots in the renderer
  // when no role-specific override is set. Kept for back-compat with
  // older scenes; new paint operations should prefer the role fields.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Role-specific overrides mirror the parent roof's surface roles.
  // When set they win over the segment's catch-all `material` and over
  // the parent roof's role / catch-all materials. Resolution order:
  //   segment role → segment catch-all → roof role → roof catch-all.
  topMaterial: MaterialSchema.optional(),
  topMaterialPreset: z.string().optional(),
  edgeMaterial: MaterialSchema.optional(),
  edgeMaterialPreset: z.string().optional(),
  wallMaterial: MaterialSchema.optional(),
  wallMaterialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Roof shape type
  roofType: RoofType.default('gable'),
  // Footprint dimensions
  width: z.number().default(8),
  depth: z.number().default(6),
  // Segment-local distances trimmed from each footprint side. The trim
  // boundary is projected vertically through the roof volume, so the
  // resulting edge follows the actual sloped roof surfaces.
  trim: RoofSegmentTrim,
  // Wall height beneath the roof
  wallHeight: z.number().default(0.5),
  // Roof pitch in degrees — angle of the primary slope face.
  // For gable/hip/shed this is the only slope; for gambrel/mansard/dutch
  // it is the steep (lower) slope. The overall peak height is derived
  // from pitch + footprint + roofType via getActiveRoofHeight().
  pitch: z.number().min(0).max(85).default(40),
  // Structure thicknesses
  wallThickness: z.number().default(0.1),
  deckThickness: z.number().default(0.1),
  overhang: z.number().default(0.3),
  shingleThickness: z.number().default(0.05),
  // Shape-specific ratios. Only the pair matching `roofType` is read; the
  // rest are inert. Defined on every segment so the panel can flip
  // roofType without losing the previous shape's tuning.
  gambrelLowerWidthRatio: z
    .number()
    .min(0.1)
    .max(0.9)
    .default(ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio),
  gambrelLowerHeightRatio: z
    .number()
    .min(0.1)
    .max(0.9)
    .default(ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio),
  mansardSteepWidthRatio: z
    .number()
    .min(0.05)
    .max(0.45)
    .default(ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio),
  mansardSteepHeightRatio: z
    .number()
    .min(0.1)
    .max(0.9)
    .default(ROOF_SHAPE_DEFAULTS.mansardSteepHeightRatio),
  dutchHipWidthRatio: z
    .number()
    .min(0.05)
    .max(0.45)
    .default(ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio),
  dutchHipHeightRatio: z
    .number()
    .min(0.1)
    .max(0.9)
    .default(ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio),
  dutchWaistLengthRatio: z
    .number()
    .min(0.1)
    .max(1)
    .default(ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio),
  dutchGabletRake: z.number().min(0).max(3).default(ROOF_SHAPE_DEFAULTS.dutchGabletRake),
  dutchTopRakeThickness: z
    .number()
    .min(0.01)
    .max(0.5)
    .default(ROOF_SHAPE_DEFAULTS.dutchTopRakeThickness),
  // Hosted accessories — chimney, dormer, skylight, box-vent,
  // ridge-vent, solar-panel, gutter. Each accessory's `parentId` points back
  // here; the segment renderer mounts them recursively via
  // `<NodeRenderer>` so they inherit the segment's transform stack.
  // Required for `createNode(child, segmentId)` to append the child
  // to this array — see
  // `wiki/architecture/node-definitions.md` ("Host kinds need a
  // `children` field on the schema").
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Roof segment node - an individual roof module within a roof group.
  Each segment generates a complete architectural volume (walls + roof).
  Multiple segments can be combined to form complex roof shapes.
  - roofType: hip, gable, shed, gambrel, dutch, mansard, flat
  - width/depth: footprint dimensions
  - trim: segment-local side cut distances
  - wallHeight: height of walls below the roof
  - pitch: roof slope in degrees (angle of the primary slope face)
  - wallThickness/deckThickness: structural thicknesses
  - overhang: eave overhang distance
  - shingleThickness: outer shingle layer thickness
  - gambrelLowerWidthRatio / gambrelLowerHeightRatio: kink position on gambrel roofs
  - mansardSteepWidthRatio / mansardSteepHeightRatio: waist position on mansard roofs
  - dutchHipWidthRatio / dutchHipHeightRatio: hip-to-gable split on dutch roofs
  - dutchWaistLengthRatio: gable waist span along the ridge axis
  - dutchGabletRake: gablet barge-board overhang past the gablet end-wall (m, 0 = none)
  - dutchTopRakeThickness: thickness of the top gable rake slab
  `,
)

export type RoofSegmentNode = z.infer<typeof RoofSegmentNode>

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeTrimAxis(start: unknown, end: unknown, span: number): readonly [number, number] {
  const maxTotal = Math.max(0, finiteNonNegative(span) - MIN_ROOF_SEGMENT_TRIM_SPAN)
  let a = Math.min(finiteNonNegative(start), maxTotal)
  let b = Math.min(finiteNonNegative(end), maxTotal)
  const total = a + b

  if (total > maxTotal && total > 0) {
    const scale = maxTotal / total
    a *= scale
    b *= scale
  }

  return [a, b] as const
}

export function normalizeRoofSegmentTrim(
  node: Pick<RoofSegmentNode, 'width' | 'depth'> & { trim?: Partial<RoofSegmentTrim> },
): RoofSegmentTrim {
  const trim = node.trim ?? {}
  const [left, right] = normalizeTrimAxis(trim.left, trim.right, node.width)
  const [back, front] = normalizeTrimAxis(trim.back, trim.front, node.depth)
  const maxWidthDiagonal = Math.max(0, finiteNonNegative(node.width) - left - right)
  const maxDepthDiagonal = Math.max(0, finiteNonNegative(node.depth) - front - back)
  const maxWidthPair = Math.max(0, maxWidthDiagonal - MIN_ROOF_SEGMENT_TRIM_SPAN)
  const maxDepthPair = Math.max(0, maxDepthDiagonal - MIN_ROOF_SEGMENT_TRIM_SPAN)
  let [frontLeftX, frontLeftZ] = normalizeCornerAxisTrim(
    trim.frontLeft,
    trim.frontLeftX,
    trim.frontLeftZ,
    maxWidthPair,
    maxDepthPair,
  )
  let [frontRightX, frontRightZ] = normalizeCornerAxisTrim(
    trim.frontRight,
    trim.frontRightX,
    trim.frontRightZ,
    maxWidthPair,
    maxDepthPair,
  )
  let [backLeftX, backLeftZ] = normalizeCornerAxisTrim(
    trim.backLeft,
    trim.backLeftX,
    trim.backLeftZ,
    maxWidthPair,
    maxDepthPair,
  )
  let [backRightX, backRightZ] = normalizeCornerAxisTrim(
    trim.backRight,
    trim.backRightX,
    trim.backRightZ,
    maxWidthPair,
    maxDepthPair,
  )

  for (let i = 0; i < 3; i += 1) {
    ;[frontLeftX, frontRightX] = normalizeTrimPair(frontLeftX, frontRightX, maxWidthPair)
    ;[backLeftX, backRightX] = normalizeTrimPair(backLeftX, backRightX, maxWidthPair)
    ;[frontLeftZ, backLeftZ] = normalizeTrimPair(frontLeftZ, backLeftZ, maxDepthPair)
    ;[frontRightZ, backRightZ] = normalizeTrimPair(frontRightZ, backRightZ, maxDepthPair)
  }

  const frontLeft = Math.min(frontLeftX, frontLeftZ)
  const frontRight = Math.min(frontRightX, frontRightZ)
  const backLeft = Math.min(backLeftX, backLeftZ)
  const backRight = Math.min(backRightX, backRightZ)

  return {
    left,
    right,
    front,
    back,
    frontLeft,
    frontRight,
    backLeft,
    backRight,
    frontLeftX,
    frontLeftZ,
    frontRightX,
    frontRightZ,
    backLeftX,
    backLeftZ,
    backRightX,
    backRightZ,
  }
}

function normalizeTrimPair(a: number, b: number, maxTotal: number): [number, number] {
  const total = a + b
  if (total <= maxTotal || total <= 0) return [a, b]
  const scale = maxTotal / total
  return [a * scale, b * scale]
}

function normalizeCornerAxisTrim(
  scalar: unknown,
  axisX: unknown,
  axisZ: unknown,
  maxX: number,
  maxZ: number,
): [number, number] {
  const x = finiteNonNegative(axisX)
  const z = finiteNonNegative(axisZ)
  const fallback = finiteNonNegative(scalar)
  if (x > 0 || z > 0) {
    return [Math.min(x, maxX), Math.min(z, maxZ)]
  }
  return [Math.min(fallback, maxX), Math.min(fallback, maxZ)]
}

// ----------------------------------------------------------------------------
// Pitch ↔ roof-peak height
//
// Pitch is the angle of the primary slope face. For each roof type the
// "primary slope" maps to a specific (rise, run) pair on the constructed
// geometry — gambrel/mansard/dutch have a multi-face slope and we standardise
// on the lower / steep face. These helpers are the single conversion point;
// all geometry consumers should call `getActiveRoofHeight` instead of reading
// a stored roofHeight field.
// ----------------------------------------------------------------------------

/** Shape of the per-type ratios consumed by the slope helpers. */
type ShapeRatios = {
  gambrelLowerWidthRatio: number
  gambrelLowerHeightRatio: number
  mansardSteepWidthRatio: number
  mansardSteepHeightRatio: number
  dutchHipWidthRatio: number
  dutchHipHeightRatio: number
  dutchWaistLengthRatio: number
}

type PitchInputs = {
  roofType: RoofType
  width: number
  depth: number
} & Partial<ShapeRatios>

export type DutchRoofMetrics = {
  axis: 'x' | 'z'
  inset: number
  waistHalfX: number
  waistHalfZ: number
  ridgeStart: readonly [number, number]
  ridgeEnd: readonly [number, number]
  shoulderInsetAlongDepth: number
  shoulderInsetAlongWidth: number
}

function getDutchUpperShellBounds(
  node: Pick<RoofSegmentNode, 'width' | 'depth'> &
    Partial<
      Pick<RoofSegmentNode, 'dutchHipWidthRatio' | 'dutchWaistLengthRatio' | 'dutchGabletRake'>
    >,
) {
  const metrics = getDutchRoofMetrics(node)
  const width = finitePositive(node.width, DEFAULT_ROOF_SEGMENT_WIDTH)
  const depth = finitePositive(node.depth, DEFAULT_ROOF_SEGMENT_DEPTH)
  const rake = node.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake
  const rakeReach =
    metrics.axis === 'x'
      ? Math.min(Math.max(0, rake), Math.max(0, width / 2 - metrics.waistHalfX) * 0.98)
      : Math.min(Math.max(0, rake), Math.max(0, depth / 2 - metrics.waistHalfZ) * 0.98)

  return {
    ...metrics,
    upperHalfX: metrics.axis === 'x' ? metrics.waistHalfX + rakeReach : metrics.waistHalfX,
    upperHalfZ: metrics.axis === 'x' ? metrics.waistHalfZ : metrics.waistHalfZ + rakeReach,
  }
}

function withRatioDefaults(input: PitchInputs): PitchInputs & ShapeRatios {
  return {
    ...input,
    width: finitePositive(input.width, DEFAULT_ROOF_SEGMENT_WIDTH),
    depth: finitePositive(input.depth, DEFAULT_ROOF_SEGMENT_DEPTH),
    gambrelLowerWidthRatio:
      input.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio,
    gambrelLowerHeightRatio:
      input.gambrelLowerHeightRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio,
    mansardSteepWidthRatio:
      input.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio,
    mansardSteepHeightRatio:
      input.mansardSteepHeightRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepHeightRatio,
    dutchHipWidthRatio: input.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio,
    dutchHipHeightRatio: input.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio,
    dutchWaistLengthRatio: input.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio,
  }
}

export function getDutchRoofMetrics(
  input: Pick<RoofSegmentNode, 'width' | 'depth'> &
    Partial<Pick<RoofSegmentNode, 'dutchHipWidthRatio' | 'dutchWaistLengthRatio'>>,
): DutchRoofMetrics {
  const width = finitePositive(input.width, DEFAULT_ROOF_SEGMENT_WIDTH)
  const depth = finitePositive(input.depth, DEFAULT_ROOF_SEGMENT_DEPTH)
  const inset =
    Math.min(width, depth) * (input.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio)
  const waistLengthRatio = input.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio

  if (width >= depth) {
    const waistHalfX = Math.max(0, (width / 2 - inset) * waistLengthRatio)
    const waistHalfZ = Math.max(0, depth / 2 - inset)
    return {
      axis: 'x',
      inset,
      waistHalfX,
      waistHalfZ,
      ridgeStart: [-waistHalfX, 0],
      ridgeEnd: [waistHalfX, 0],
      shoulderInsetAlongDepth: Math.max(0, depth / 2 - waistHalfZ),
      shoulderInsetAlongWidth: Math.max(0, width / 2 - waistHalfX),
    }
  }

  const waistHalfX = Math.max(0, width / 2 - inset)
  const waistHalfZ = Math.max(0, (depth / 2 - inset) * waistLengthRatio)
  return {
    axis: 'z',
    inset,
    waistHalfX,
    waistHalfZ,
    ridgeStart: [0, waistHalfZ],
    ridgeEnd: [0, -waistHalfZ],
    shoulderInsetAlongDepth: Math.max(0, depth / 2 - waistHalfZ),
    shoulderInsetAlongWidth: Math.max(0, width / 2 - waistHalfX),
  }
}

function getPrimarySlopeRun(input: PitchInputs & ShapeRatios): number {
  const min = Math.min(input.width, input.depth)
  switch (input.roofType) {
    case 'shed':
      return input.depth
    case 'gable':
      return input.depth / 2
    case 'gambrel':
      return (input.depth / 2) * input.gambrelLowerWidthRatio
    case 'mansard':
      return min * input.mansardSteepWidthRatio
    case 'dutch':
      return min * input.dutchHipWidthRatio
    default:
      return min / 2
  }
}

// Fraction of the overall peak height that is taken up by the primary slope.
function getPrimarySlopeRiseFraction(input: PitchInputs & ShapeRatios): number {
  switch (input.roofType) {
    case 'gambrel':
      return input.gambrelLowerHeightRatio
    case 'mansard':
      return input.mansardSteepHeightRatio
    case 'dutch':
      return input.dutchHipHeightRatio
    default:
      return 1
  }
}

export type SegmentSlopeFrame = {
  /** Horizontal half-span of the primary slope face (eave-to-ridge). */
  run: number
  /** Vertical height of the primary slope face. */
  rise: number
  /** tan(pitch). 0 for flat or zero-pitch segments. */
  tanTheta: number
  /** cos(pitch). 1 for flat or zero-pitch segments. */
  cosTheta: number
  /** sin(pitch). 0 for flat or zero-pitch segments. */
  sinTheta: number
  /** Overall eave-to-peak height of the assembled roof. */
  activeRh: number
}

/**
 * One stop for the slope math every roof-segment consumer needs. Builds
 * `run`, `rise`, the trig triple, and the overall peak height from the
 * segment's pitch + footprint + roofType. Before this helper existed,
 * the table was duplicated in three places (the brush builder, the
 * skylight surface-frame routine, and the segment-hit raycaster) and
 * silently drifted when a new roof type was added.
 */
export function getSegmentSlopeFrame(
  node: Pick<RoofSegmentNode, 'roofType' | 'pitch' | 'width' | 'depth'> & Partial<ShapeRatios>,
): SegmentSlopeFrame {
  const ratios = withRatioDefaults(node)
  const run = getPrimarySlopeRun(ratios)
  // `!(pitch > 0)` (not `pitch <= 0`) so a missing/NaN pitch — e.g. a segment
  // from an older migration that only set `roofHeight`, or stale persisted data —
  // resolves to a flat frame instead of computing `Math.tan(NaN)` → NaN geometry,
  // which poisons the merged-roof CSG ("Coplanar clip not handled" + NaN positions).
  if (node.roofType === 'flat' || !(node.pitch > 0)) {
    return { run, rise: 0, tanTheta: 0, cosTheta: 1, sinTheta: 0, activeRh: 0 }
  }
  const pitchRad = (node.pitch * Math.PI) / 180
  const tanTheta = Math.tan(pitchRad)
  const cosTheta = Math.cos(pitchRad) || 1
  const sinTheta = Math.sin(pitchRad)
  const rise = run * tanTheta
  const activeRh = rise / getPrimarySlopeRiseFraction(ratios)
  return { run, rise, tanTheta, cosTheta, sinTheta, activeRh }
}

/**
 * The eave-to-peak height of the assembled segment, derived from pitch +
 * footprint + roofType. Replaces the legacy `roofHeight` field on the node.
 */
export function getActiveRoofHeight(node: Parameters<typeof getSegmentSlopeFrame>[0]): number {
  return getSegmentSlopeFrame(node).activeRh
}

export type RoofSegmentVisibleTopBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
}

export function getRoofSegmentVisibleTopBounds(
  segment: RoofSegmentNode,
): RoofSegmentVisibleTopBounds {
  const { activeRh, cosTheta, sinTheta } = getSegmentSlopeFrame(segment)
  const width = finitePositive(segment.width, DEFAULT_ROOF_SEGMENT_WIDTH)
  const depth = finitePositive(segment.depth, DEFAULT_ROOF_SEGMENT_DEPTH)
  const trim = normalizeRoofSegmentTrim({ ...segment, width, depth })
  const horizontalOverhang = finiteNonNegative(segment.overhang) * cosTheta
  const deckExt = finiteNonNegative(segment.wallThickness) / 2 + horizontalOverhang
  const shingleOverhang = finiteNonNegative(segment.shingleThickness) * sinTheta

  let xExt = deckExt
  let frontExt = deckExt
  let backExt = deckExt

  if (
    segment.roofType === 'hip' ||
    segment.roofType === 'mansard' ||
    segment.roofType === 'dutch'
  ) {
    xExt += shingleOverhang
    frontExt += shingleOverhang
    backExt += shingleOverhang
  } else if (segment.roofType === 'gable' || segment.roofType === 'gambrel') {
    frontExt += shingleOverhang
    backExt += shingleOverhang
  } else if (segment.roofType === 'shed' && activeRh > 0) {
    frontExt += shingleOverhang
  }

  let minX = trim.left > 0 ? -width / 2 + trim.left : -width / 2 - xExt
  let maxX = trim.right > 0 ? width / 2 - trim.right : width / 2 + xExt
  let minZ = trim.back > 0 ? -depth / 2 + trim.back : -depth / 2 - backExt
  let maxZ = trim.front > 0 ? depth / 2 - trim.front : depth / 2 + frontExt

  if (trim.frontLeftX > 0 && trim.frontLeftZ > 0 && maxZ - trim.frontLeftZ < 0) {
    minX = Math.max(minX, minX + (trim.frontLeftX * (trim.frontLeftZ - maxZ)) / trim.frontLeftZ)
  }
  if (trim.backLeftX > 0 && trim.backLeftZ > 0 && minZ + trim.backLeftZ > 0) {
    minX = Math.max(minX, minX + (trim.backLeftX * (trim.backLeftZ + minZ)) / trim.backLeftZ)
  }
  if (trim.frontRightX > 0 && trim.frontRightZ > 0 && maxZ - trim.frontRightZ < 0) {
    maxX = Math.min(maxX, maxX - (trim.frontRightX * (trim.frontRightZ - maxZ)) / trim.frontRightZ)
  }
  if (trim.backRightX > 0 && trim.backRightZ > 0 && minZ + trim.backRightZ > 0) {
    maxX = Math.min(maxX, maxX - (trim.backRightX * (trim.backRightZ + minZ)) / trim.backRightZ)
  }

  if (trim.frontLeftX > 0 && trim.frontLeftZ > 0 && minX + trim.frontLeftX > 0) {
    maxZ = Math.min(maxZ, maxZ - (trim.frontLeftZ * (trim.frontLeftX + minX)) / trim.frontLeftX)
  }
  if (trim.frontRightX > 0 && trim.frontRightZ > 0 && maxX - trim.frontRightX < 0) {
    maxZ = Math.min(maxZ, maxZ - (trim.frontRightZ * (trim.frontRightX - maxX)) / trim.frontRightX)
  }
  if (trim.backLeftX > 0 && trim.backLeftZ > 0 && minX + trim.backLeftX > 0) {
    minZ = Math.max(minZ, minZ + (trim.backLeftZ * (trim.backLeftX + minX)) / trim.backLeftX)
  }
  if (trim.backRightX > 0 && trim.backRightZ > 0 && maxX - trim.backRightX < 0) {
    minZ = Math.max(minZ, minZ + (trim.backRightZ * (trim.backRightX - maxX)) / trim.backRightX)
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: Math.max(0.01, maxX - minX),
    depth: Math.max(0.01, maxZ - minZ),
  }
}

/** Segment-local surface height used by roof accessory placement and hit disambiguation. */
export function getRoofSegmentSurfaceY(
  node: Pick<RoofSegmentNode, 'roofType' | 'width' | 'depth' | 'wallHeight'> &
    Parameters<typeof getSegmentSlopeFrame>[0],
  localX: number,
  localZ: number,
): number {
  const slopeFrame = getSegmentSlopeFrame(node)
  const activeRh = slopeFrame.activeRh
  const peakY = node.wallHeight + activeRh
  if (activeRh === 0) return node.wallHeight

  if (node.roofType === 'gable' || node.roofType === 'gambrel' || node.roofType === 'mansard') {
    const t = node.depth > 0 ? Math.abs(localZ) / (node.depth / 2) : 0
    return peakY - t * activeRh
  }

  if (node.roofType === 'dutch') {
    const hipHeightRatio = node.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio
    const metrics = getDutchUpperShellBounds(node)
    const lowerRise = activeRh * hipHeightRatio
    if (metrics.axis === 'x') {
      const waistHalfZ = Math.max(0.0001, metrics.waistHalfZ)
      if (Math.abs(localX) <= metrics.upperHalfX && Math.abs(localZ) <= waistHalfZ) {
        const upperRise = activeRh * (1 - hipHeightRatio)
        const upperTan = upperRise / waistHalfZ
        return peakY - Math.abs(localZ) * upperTan
      }

      const xProgressDenom = Math.max(0.0001, node.width / 2 - metrics.waistHalfX)
      const zProgressDenom = Math.max(0.0001, node.depth / 2 - waistHalfZ)
      const xProgress = Math.max(0, Math.abs(localX) - metrics.waistHalfX) / xProgressDenom
      const zProgress = Math.max(0, Math.abs(localZ) - waistHalfZ) / zProgressDenom
      return node.wallHeight + lowerRise * (1 - Math.min(1, Math.max(xProgress, zProgress)))
    }

    const waistHalfX = Math.max(0.0001, metrics.waistHalfX)
    if (Math.abs(localX) <= waistHalfX && Math.abs(localZ) <= metrics.upperHalfZ) {
      const upperRise = activeRh * (1 - hipHeightRatio)
      const upperRun = waistHalfX
      const upperTan = upperRise / upperRun
      return peakY - Math.abs(localX) * upperTan
    }
    const xProgressDenom = Math.max(0.0001, node.width / 2 - waistHalfX)
    const zProgressDenom = Math.max(0.0001, node.depth / 2 - metrics.waistHalfZ)
    const xProgress = Math.max(0, Math.abs(localX) - waistHalfX) / xProgressDenom
    const zProgress = Math.max(0, Math.abs(localZ) - metrics.waistHalfZ) / zProgressDenom
    return node.wallHeight + lowerRise * (1 - Math.min(1, Math.max(xProgress, zProgress)))
  }

  if (node.roofType === 'shed') {
    const t = (localZ + node.depth / 2) / (node.depth || 1)
    return peakY - t * activeRh
  }

  if (node.roofType === 'hip') {
    const fx = node.width > 0 ? Math.abs(localX) / (node.width / 2) : 0
    const fz = node.depth > 0 ? Math.abs(localZ) / (node.depth / 2) : 0
    return peakY - Math.max(fx, fz) * activeRh
  }

  const t = node.depth > 0 ? Math.abs(localZ) / (node.depth / 2) : 0
  return peakY - t * activeRh
}

/**
 * Inverse of `getActiveRoofHeight` — recover the pitch a legacy
 * `roofHeight` value would correspond to. Used by the scene migration.
 * Ratio overrides are optional and default to the shape defaults.
 */
export function getPitchFromActiveRoofHeight(input: PitchInputs & { roofHeight: number }): number {
  if (input.roofType === 'flat' || input.roofHeight <= 0) return 0
  const ratios = withRatioDefaults(input)
  const run = getPrimarySlopeRun(ratios)
  if (run <= 0) return 0
  const rise = input.roofHeight * getPrimarySlopeRiseFraction(ratios)
  return (Math.atan2(rise, run) * 180) / Math.PI
}

// ----------------------------------------------------------------------------
// Per-segment surface materials
// ----------------------------------------------------------------------------

export type RoofSegmentSurfaceMaterialRole = 'top' | 'edge' | 'wall'
export type RoofSegmentSurfaceMaterialSpec = {
  material?: MaterialSchemaType
  materialPreset?: string
}

function getLegacyRoofSegmentSurfaceMaterial(
  node: RoofSegmentNode,
): RoofSegmentSurfaceMaterialSpec {
  return {
    material: node.material,
    materialPreset: typeof node.materialPreset === 'string' ? node.materialPreset : undefined,
  }
}

/**
 * Resolve the segment-level material for one of the three surface roles.
 * Falls back through: role-specific field → catch-all `material`. Pass the
 * parent roof to `parentFallback` when you want the roof's role material
 * to fill in for an unset segment slot — typical from the renderer.
 */
export function getEffectiveSegmentSurfaceMaterial(
  node: RoofSegmentNode,
  role: RoofSegmentSurfaceMaterialRole,
  parentFallback?: RoofSegmentSurfaceMaterialSpec,
): RoofSegmentSurfaceMaterialSpec {
  if (role === 'top') {
    if (node.topMaterial !== undefined || typeof node.topMaterialPreset === 'string') {
      return {
        material: node.topMaterial,
        materialPreset:
          typeof node.topMaterialPreset === 'string' ? node.topMaterialPreset : undefined,
      }
    }
  } else if (role === 'edge') {
    if (node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string') {
      return {
        material: node.edgeMaterial,
        materialPreset:
          typeof node.edgeMaterialPreset === 'string' ? node.edgeMaterialPreset : undefined,
      }
    }
  } else if (role === 'wall') {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      return {
        material: node.wallMaterial,
        materialPreset:
          typeof node.wallMaterialPreset === 'string' ? node.wallMaterialPreset : undefined,
      }
    }
  }

  const legacy = getLegacyRoofSegmentSurfaceMaterial(node)
  if (legacy.material !== undefined || legacy.materialPreset !== undefined) return legacy

  return parentFallback ?? { material: undefined, materialPreset: undefined }
}

/**
 * Returns true when the segment has any segment-level material override —
 * either the legacy catch-all or any of the three role-specific fields.
 * Used by `RoofRenderer` and `updateMergedRoofGeometry` to decide whether
 * the segment should be drawn as its own mesh or folded into the merged
 * shell.
 */
export function hasSegmentMaterialOverride(node: RoofSegmentNode): boolean {
  return (
    node.material !== undefined ||
    typeof node.materialPreset === 'string' ||
    node.topMaterial !== undefined ||
    typeof node.topMaterialPreset === 'string' ||
    node.edgeMaterial !== undefined ||
    typeof node.edgeMaterialPreset === 'string' ||
    node.wallMaterial !== undefined ||
    typeof node.wallMaterialPreset === 'string'
  )
}
