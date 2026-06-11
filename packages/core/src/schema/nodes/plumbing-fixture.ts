import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Plumbing fixture — where the DWV system starts: water closet,
 * lavatory, kitchen sink, tub/shower, clothes washer.
 *
 * Each fixture exposes one waste port at its floor rough-in point, so
 * drain runs are drawn FROM a fixture toward the stack. Fixture-unit
 * values (IPC DFU) are derived from the type — they feed the system
 * summary and, in a later slice, the pipe-sizing validators.
 *
 * Floor-placed: `position` is level-local meters with y at the floor,
 * `rotation` is yaw radians.
 */
export const PlumbingFixtureNode = BaseNode.extend({
  id: objectId('plumbing-fixture'),
  type: nodeType('plumbing-fixture'),
  // Level-local meters, y at the floor.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw in radians.
  rotation: z.number().default(0),
  fixtureType: z.enum(['toilet', 'lavatory', 'kitchen-sink', 'tub', 'washer']).default('toilet'),
}).describe(
  dedent`
  Plumbing fixture - toilet, lavatory (bath sink), kitchen sink, tub/shower, or clothes washer.
  - position: [x, y, z] level-local meters (y = floor)
  - rotation: yaw radians
  - fixtureType drives geometry, the drain rough-in port size, and the IPC fixture-unit value
  `,
)
export type PlumbingFixtureNode = z.infer<typeof PlumbingFixtureNode>
export type PlumbingFixtureNodeId = PlumbingFixtureNode['id']
