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

const PlanarMeasurementBase = z
  .array(MeasurementPoint)
  .min(3)
  .superRefine((points, ctx) => {
    if (!areMeasurementPointsCoplanar(points, MEASUREMENT_PLANAR_TOLERANCE)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Measurement base must be planar and enclose an area',
      })
    }
  })

export const DistanceMeasurement = z.object({
  kind: z.literal('distance'),
  points: z.tuple([MeasurementPoint, MeasurementPoint]),
})

export const AreaMeasurement = z.object({
  kind: z.literal('area'),
  base: PlanarMeasurementBase,
})

export const VolumeMeasurement = z
  .object({
    kind: z.literal('volume'),
    base: PlanarMeasurementBase,
    extrusion: MeasurementPoint,
  })
  .superRefine((measurement, ctx) => {
    const normal = measurementNormal(measurement.base)
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
  AreaMeasurement,
  VolumeMeasurement,
])

export const MeasurementNode = BaseNode.extend({
  id: objectId('measurement'),
  type: nodeType('measurement'),
  measurement: MeasurementPayload,
}).describe(
  dedent`
  Measurement node - a persistent level-local 3D measurement annotation
  - distance: exactly two level-local points
  - area: an ordered planar base with at least three points
  - volume: an ordered planar base with an extrusion vector
  `,
)

export type MeasurementPoint = z.infer<typeof MeasurementPoint>
export type DistanceMeasurement = z.infer<typeof DistanceMeasurement>
export type AreaMeasurement = z.infer<typeof AreaMeasurement>
export type VolumeMeasurement = z.infer<typeof VolumeMeasurement>
export type MeasurementPayload = z.infer<typeof MeasurementPayload>
export type MeasurementNode = z.infer<typeof MeasurementNode>
