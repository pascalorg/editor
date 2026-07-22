import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MeasurementAnchor } from './measurement'

const FiniteCoordinate = z.number().finite()

export const ConstructionDimensionBaseline = z
  .object({
    origin: z.tuple([FiniteCoordinate, FiniteCoordinate]).default([0, 0.6]),
    direction: z.tuple([FiniteCoordinate, FiniteCoordinate]).default([1, 0]),
  })
  .superRefine((baseline, ctx) => {
    if (Math.hypot(baseline.direction[0], baseline.direction[1]) <= 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: ['direction'],
        message: 'Construction dimension baseline direction must be non-zero',
      })
    }
  })

export const ConstructionDimensionChainMode = z.enum(['point-to-point', 'continuous'])
export const ConstructionDimensionMode = z.enum([
  'linear',
  'radius',
  'diameter',
  'center-mark',
  'chord',
  'arc-length',
  'angular',
  'coordinate',
])
export const ConstructionDrawingType = z.enum([
  'floor-plan',
  'foundation-plan',
  'reflected-ceiling-plan',
  'roof-plan',
  'site-plan',
])
export const ConstructionDimensionDrawingPresentation = z.enum(['shown', 'omit', 'controlled'])
export const ConstructionDimensionDrawingOverride = z.object({
  drawingType: ConstructionDrawingType,
  presentation: ConstructionDimensionDrawingPresentation,
  suppressedSegmentIndexes: z.array(z.number().int().min(0).max(999)).max(200).default([]),
})
export const ConstructionDimensionDatumPolicy = z.enum([
  'centerline',
  'wall-face',
  'structural-face',
  'finish-face',
])
export const ConstructionDimensionTerminator = z.enum([
  'architectural-tick',
  'filled-arrow',
  'open-arrow',
  'dot',
])
export const ConstructionDimensionTextPosition = z.enum(['above', 'centered'])
export const ConstructionDimensionImperialPrecision = z.enum(['1', '1/2', '1/4', '1/8', '1/16'])
export const ConstructionDimensionMetricNotation = z.enum(['meters', 'millimeters'])

export const ConstructionDimensionNode = BaseNode.extend({
  id: objectId('construction-dimension'),
  type: nodeType('construction-dimension'),
  anchors: z
    .array(MeasurementAnchor)
    .min(2)
    .default([
      [0, 0, 0],
      [1, 0, 0],
    ]),
  baseline: ConstructionDimensionBaseline.default({ origin: [0, 0.6], direction: [1, 0] }),
  chainMode: ConstructionDimensionChainMode.default('point-to-point'),
  mode: ConstructionDimensionMode.default('linear'),
  featureCount: z.number().int().min(1).max(999).default(1),
  showCenterMark: z.boolean().default(true),
  prefix: z.string().max(40).default(''),
  suffix: z.string().max(40).default(''),
  textOverride: z.string().trim().min(1).max(120).nullable().default(null),
  datumPolicy: ConstructionDimensionDatumPolicy.default('centerline'),
  terminator: ConstructionDimensionTerminator.default('architectural-tick'),
  textPosition: ConstructionDimensionTextPosition.default('above'),
  imperialPrecision: ConstructionDimensionImperialPrecision.default('1/16'),
  metricNotation: ConstructionDimensionMetricNotation.default('meters'),
  extensionStartGap: z.number().finite().min(0).max(1).default(0.075),
  extensionOvershoot: z.number().finite().min(0).max(1).default(0.12),
  drawingType: ConstructionDrawingType.default('floor-plan'),
  drawingOverrides: z.array(ConstructionDimensionDrawingOverride).max(5).default([]),
  controllingDimensionId: objectId('construction-dimension').nullable().default(null),
}).describe(
  dedent`
  Construction dimension node - an associative floor-plan construction dimension
  - anchors: two or more free or semantic feature anchors that supply the witness origins
  - baseline.origin: a point on the independently placed dimension line
  - baseline.direction: the fixed plan direction used to project the witness origins
  - chainMode: point-to-point for one segment or continuous for adjacent dimension strings
  - mode: linear, radius, diameter, center mark, chord, arc length, angular, or coordinate
  - featureCount: repeated-feature multiplier used by diameter/radius and other notation
  - showCenterMark: displays the resolved circle/angle center where applicable
  - prefix/suffix/textOverride: document notation overrides without changing geometry
  - datumPolicy/terminator/textPosition/imperialPrecision/metricNotation/extensionStartGap/extensionOvershoot: dimension-standard overrides
  - drawingType: the primary persistent drawing that owns the dimension
  - drawingOverrides: omit, show, or foundation-control presentation per drawing type
  - controllingDimensionId: foundation dimension whose associative geometry controls this dimension
  `,
)

export type ConstructionDimensionBaseline = z.infer<typeof ConstructionDimensionBaseline>
export type ConstructionDimensionChainMode = z.infer<typeof ConstructionDimensionChainMode>
export type ConstructionDimensionMode = z.infer<typeof ConstructionDimensionMode>
export type ConstructionDrawingType = z.infer<typeof ConstructionDrawingType>
export type ConstructionDimensionDrawingPresentation = z.infer<
  typeof ConstructionDimensionDrawingPresentation
>
export type ConstructionDimensionDrawingOverride = z.infer<
  typeof ConstructionDimensionDrawingOverride
>
export type ConstructionDimensionDatumPolicy = z.infer<typeof ConstructionDimensionDatumPolicy>
export type ConstructionDimensionTerminator = z.infer<typeof ConstructionDimensionTerminator>
export type ConstructionDimensionTextPosition = z.infer<typeof ConstructionDimensionTextPosition>
export type ConstructionDimensionImperialPrecision = z.infer<
  typeof ConstructionDimensionImperialPrecision
>
export type ConstructionDimensionMetricNotation = z.infer<
  typeof ConstructionDimensionMetricNotation
>
export type ConstructionDimensionNode = z.infer<typeof ConstructionDimensionNode>

export const CONSTRUCTION_DRAWING_TYPES = ConstructionDrawingType.options

export function resolveConstructionDimensionDrawingPresentation(
  node: Pick<ConstructionDimensionNode, 'drawingType' | 'drawingOverrides'>,
  drawingType: ConstructionDrawingType,
): ConstructionDimensionDrawingPresentation {
  let override: ConstructionDimensionDrawingOverride | undefined
  for (const entry of node.drawingOverrides) {
    if (entry.drawingType === drawingType) override = entry
  }
  return override?.presentation ?? (node.drawingType === drawingType ? 'shown' : 'omit')
}

export function resolveConstructionDimensionDrawingOverride(
  node: Pick<ConstructionDimensionNode, 'drawingOverrides'>,
  drawingType: ConstructionDrawingType,
): ConstructionDimensionDrawingOverride | null {
  let override: ConstructionDimensionDrawingOverride | undefined
  for (const entry of node.drawingOverrides) {
    if (entry.drawingType === drawingType) override = entry
  }
  return override ?? null
}

export function setConstructionDimensionDrawingPresentation(
  node: Pick<ConstructionDimensionNode, 'drawingType' | 'drawingOverrides'>,
  drawingType: ConstructionDrawingType,
  presentation: ConstructionDimensionDrawingPresentation,
): ConstructionDimensionDrawingOverride[] {
  const defaultPresentation = node.drawingType === drawingType ? 'shown' : 'omit'
  const existing = resolveConstructionDimensionDrawingOverride(node, drawingType)
  const withoutDrawing = node.drawingOverrides.filter((entry) => entry.drawingType !== drawingType)
  const next = {
    drawingType,
    presentation,
    suppressedSegmentIndexes: existing?.suppressedSegmentIndexes ?? [],
  }
  return isDefaultConstructionDimensionDrawingOverride(next, defaultPresentation)
    ? withoutDrawing
    : [...withoutDrawing, next]
}

export function setConstructionDimensionDrawingSuppressedSegments(
  node: Pick<ConstructionDimensionNode, 'drawingType' | 'drawingOverrides'>,
  drawingType: ConstructionDrawingType,
  suppressedSegmentIndexes: readonly number[],
): ConstructionDimensionDrawingOverride[] {
  const defaultPresentation = node.drawingType === drawingType ? 'shown' : 'omit'
  const existing = resolveConstructionDimensionDrawingOverride(node, drawingType)
  const presentation = existing?.presentation ?? defaultPresentation
  const suppressed = normalizeSuppressedSegmentIndexes(suppressedSegmentIndexes)
  const withoutDrawing = node.drawingOverrides.filter((entry) => entry.drawingType !== drawingType)
  const next = { drawingType, presentation, suppressedSegmentIndexes: suppressed }
  return isDefaultConstructionDimensionDrawingOverride(next, defaultPresentation)
    ? withoutDrawing
    : [...withoutDrawing, next]
}

export function constructionDimensionRequiredAnchorCount(mode: ConstructionDimensionMode): number {
  return mode === 'arc-length' || mode === 'angular' ? 3 : 2
}

function isDefaultConstructionDimensionDrawingOverride(
  override: ConstructionDimensionDrawingOverride,
  defaultPresentation: ConstructionDimensionDrawingPresentation,
): boolean {
  return (
    override.presentation === defaultPresentation && override.suppressedSegmentIndexes.length === 0
  )
}

function normalizeSuppressedSegmentIndexes(indexes: readonly number[]): number[] {
  return [...new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0))].sort(
    (left, right) => left - right,
  )
}
