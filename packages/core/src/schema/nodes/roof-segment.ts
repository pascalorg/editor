import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RoofType = z.enum(['hip', 'gable', 'shed', 'gambrel', 'dutch', 'mansard', 'flat'])

export type RoofType = z.infer<typeof RoofType>

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
} as const

export const RoofSegmentNode = BaseNode.extend({
  id: objectId('rseg'),
  type: nodeType('roof-segment'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Roof shape type
  roofType: RoofType.default('gable'),
  // Footprint dimensions
  width: z.number().default(8),
  depth: z.number().default(6),
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
  // Hosted accessories — chimney, dormer, skylight, box-vent,
  // ridge-vent, solar-panel. Each accessory's `parentId` points back
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
  - wallHeight: height of walls below the roof
  - pitch: roof slope in degrees (angle of the primary slope face)
  - wallThickness/deckThickness: structural thicknesses
  - overhang: eave overhang distance
  - shingleThickness: outer shingle layer thickness
  - gambrelLowerWidthRatio / gambrelLowerHeightRatio: kink position on gambrel roofs
  - mansardSteepWidthRatio / mansardSteepHeightRatio: waist position on mansard roofs
  - dutchHipWidthRatio / dutchHipHeightRatio: hip-to-gable split on dutch roofs
  `,
)

export type RoofSegmentNode = z.infer<typeof RoofSegmentNode>

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
}

type PitchInputs = {
  roofType: RoofType
  width: number
  depth: number
} & Partial<ShapeRatios>

function withRatioDefaults(input: PitchInputs): PitchInputs & ShapeRatios {
  return {
    ...input,
    gambrelLowerWidthRatio:
      input.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio,
    gambrelLowerHeightRatio:
      input.gambrelLowerHeightRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio,
    mansardSteepWidthRatio:
      input.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio,
    mansardSteepHeightRatio:
      input.mansardSteepHeightRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepHeightRatio,
    dutchHipWidthRatio: input.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio,
    dutchHipHeightRatio:
      input.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio,
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
    case 'hip':
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
  node: Pick<RoofSegmentNode, 'roofType' | 'pitch' | 'width' | 'depth'> &
    Partial<ShapeRatios>,
): SegmentSlopeFrame {
  const ratios = withRatioDefaults(node)
  const run = getPrimarySlopeRun(ratios)
  if (node.roofType === 'flat' || node.pitch <= 0) {
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
export function getActiveRoofHeight(
  node: Parameters<typeof getSegmentSlopeFrame>[0],
): number {
  return getSegmentSlopeFrame(node).activeRh
}

/**
 * Inverse of `getActiveRoofHeight` — recover the pitch a legacy
 * `roofHeight` value would correspond to. Used by the scene migration.
 * Ratio overrides are optional and default to the shape defaults.
 */
export function getPitchFromActiveRoofHeight(
  input: PitchInputs & { roofHeight: number },
): number {
  if (input.roofType === 'flat' || input.roofHeight <= 0) return 0
  const ratios = withRatioDefaults(input)
  const run = getPrimarySlopeRun(ratios)
  if (run <= 0) return 0
  const rise = input.roofHeight * getPrimarySlopeRiseFraction(ratios)
  return (Math.atan2(rise, run) * 180) / Math.PI
}
