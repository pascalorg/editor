import dedent from 'dedent'
import { z } from 'zod'
import {
  areMeasurementPointsCoplanar,
  MEASUREMENT_PLANAR_TOLERANCE,
  measurementNormal,
} from '../../lib/measurement-geometry'
import { BaseNode, nodeType, objectId } from '../base'

const FiniteCoordinate = z.number().finite()

export const MeasurementPoint = z.tuple([FiniteCoordinate, FiniteCoordinate, FiniteCoordinate])

export const MeasurementFeatureParameter = z.union([z.string(), z.boolean(), FiniteCoordinate])

export const MeasurementFeatureReference = z.object({
  nodeId: z.string().min(1),
  featureId: z.string().min(1),
  parameters: z.record(z.string(), MeasurementFeatureParameter).optional(),
})

export const MeasurementFeatureAnchor = z.object({
  kind: z.literal('feature'),
  reference: MeasurementFeatureReference,
  fallback: MeasurementPoint,
})

/** A tuple is a free anchor and remains the compact legacy representation. */
export const MeasurementAnchor = z.union([MeasurementPoint, MeasurementFeatureAnchor])

const fallbackPoint = (anchor: z.infer<typeof MeasurementAnchor>) =>
  Array.isArray(anchor) ? anchor : anchor.fallback

const PlanarMeasurementBase = z
  .array(MeasurementAnchor)
  .min(3)
  .superRefine((anchors, ctx) => {
    if (!areMeasurementPointsCoplanar(anchors.map(fallbackPoint), MEASUREMENT_PLANAR_TOLERANCE)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Measurement base must be planar and enclose an area',
      })
    }
  })

export const DistanceMeasurement = z.object({
  kind: z.literal('distance'),
  points: z.tuple([MeasurementAnchor, MeasurementAnchor]),
})

export const AngleMeasurement = z.object({
  kind: z.literal('angle'),
  points: z.tuple([MeasurementAnchor, MeasurementAnchor, MeasurementAnchor]),
})

export const AreaMeasurement = z.object({
  kind: z.literal('area'),
  base: PlanarMeasurementBase,
})

export const PerimeterMeasurement = z.object({
  kind: z.literal('perimeter'),
  base: PlanarMeasurementBase,
})

export const VolumeMeasurement = z
  .object({
    kind: z.literal('volume'),
    base: PlanarMeasurementBase,
    extrusion: MeasurementPoint,
  })
  .superRefine((measurement, ctx) => {
    const normal = measurementNormal(measurement.base.map(fallbackPoint))
    const normalComponent = normal
      ? Math.abs(
          normal[0] * measurement.extrusion[0] +
            normal[1] * measurement.extrusion[1] +
            normal[2] * measurement.extrusion[2],
        )
      : 0
    if (normalComponent <= 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: ['extrusion'],
        message: 'Measurement extrusion must have a non-zero normal component',
      })
    }
  })

export const MeasurementPayload = z.discriminatedUnion('kind', [
  DistanceMeasurement,
  AngleMeasurement,
  AreaMeasurement,
  PerimeterMeasurement,
  VolumeMeasurement,
])

export const MeasurementNode = BaseNode.extend({
  id: objectId('measurement'),
  type: nodeType('measurement'),
  measurement: MeasurementPayload,
}).describe(
  dedent`
  Measurement node - a persistent level-local 3D measurement annotation
  - distance: exactly two level-local anchors
  - angle: exactly three anchors, with the middle anchor as the vertex
  - area/perimeter: an ordered planar base with at least three anchors
  - volume: an ordered planar base with an extrusion vector
  - an anchor is either a free point tuple or a semantic feature reference with a fallback
  `,
)

export type MeasurementPoint = z.infer<typeof MeasurementPoint>
export type MeasurementFeatureParameter = z.infer<typeof MeasurementFeatureParameter>
export type MeasurementFeatureReference = z.infer<typeof MeasurementFeatureReference>
export type MeasurementFeatureAnchor = z.infer<typeof MeasurementFeatureAnchor>
export type MeasurementAnchor = z.infer<typeof MeasurementAnchor>
export type DistanceMeasurement = z.infer<typeof DistanceMeasurement>
export type AngleMeasurement = z.infer<typeof AngleMeasurement>
export type AreaMeasurement = z.infer<typeof AreaMeasurement>
export type PerimeterMeasurement = z.infer<typeof PerimeterMeasurement>
export type VolumeMeasurement = z.infer<typeof VolumeMeasurement>
export type MeasurementPayload = z.infer<typeof MeasurementPayload>
export type MeasurementNode = z.infer<typeof MeasurementNode>
