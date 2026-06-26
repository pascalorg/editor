import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const PropertyLineData = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])),
})

/**
 * Angle in radians, counter-clockwise from world +X axis, that points toward
 * True North. Default: Math.PI / 2 (i.e. +Z is south, matching the
 * two-bedroom template convention where positive-Z points south and +X is east).
 *
 * Examples:
 *   0          → north is world +X (east on a standard north-up plan)
 *   Math.PI/2  → north is world +Z (default; +Z points north... wait, no:
 *                 CCW from +X by 90° lands on +Z — so +Z IS north here)
 *
 * Tip: to map a surveyor's "bearing from True North" (clockwise degrees) to
 * this value: northDirection = Math.PI/2 - bearing * (Math.PI/180)
 */
export const NORTH_DIRECTION_DEFAULT = Math.PI / 2

export const SiteNode = BaseNode.extend({
  id: objectId('site'),
  type: nodeType('site'),
  polygon: PropertyLineData.optional().default({
    type: 'polygon',
    points: [
      [-15, -15],
      [15, -15],
      [15, 15],
      [-15, 15],
    ],
  }),
  /**
   * True-North direction: radians, CCW from world +X axis.
   * Default (π/2) means world +Z points north, world +X points east —
   * consistent with the two-bedroom template and standard north-up site plans.
   */
  northDirection: z.number().default(NORTH_DIRECTION_DEFAULT),
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data
  - northDirection: True North angle in radians, CCW from world +X (default π/2 = +Z is north)
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
