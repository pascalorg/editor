import dedent from 'dedent'
import { z } from 'zod'

export const EnvironmentNode = z
  .object({
    object: z.literal('environment').default('environment'),
    latitude: z.number().default(0), // degrees
    longitude: z.number().default(0), // degrees
    altitude: z.number().default(0), // meters above sea level
  })
  .describe(
    dedent`
  Environment config - used to synchronize lighting and sky orientation with the real world sun position, X axis is pointing south, Y is up, Z is east
  - latitude: latitude in degrees
  - longitude: longitude in degrees
  - altitude: altitude in meters above sea level
  `,
  )

export type EnvironmentNode = z.infer<typeof EnvironmentNode>
