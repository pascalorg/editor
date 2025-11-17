import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const EnvironmentNode = z
  .object({
    id: nodeId('environment'),
    type: nodeType('environment'),
    latitude: z.number().default(0), // degrees
    longitude: z.number().default(0), // degrees
    altitude: z.number().default(0), // meters above sea level
    time: z.number().default(0), // seconds since midnight
  })
  .describe(
    dedent`
  Environment node - used to synchronize lighting and sky orientation with the real world sun position, X axis is pointing south, Y is up, Z is east
  - latitude: latitude in degrees
  - longitude: longitude in degrees
  - altitude: altitude in meters above sea level
  - time: time in seconds since midnight
  `,
  )

export type EnvironmentNode = z.infer<typeof EnvironmentNode>
