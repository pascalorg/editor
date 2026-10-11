import dedent from 'dedent'
import { z } from 'zod'
import { FacadeModeSchema } from '../../systems/facade/facade-config'
import { FacadeSetSchema } from '../../systems/facade/facade-set'
import { BaseNode, nodeType, objectId } from '../base'

const PlanPoint = z.tuple([z.number(), z.number()])

/**
 * A stretch of facade in plan, with the direction its outside faces. Walls on
 * any storey that lie along it belong to it, so one picked wall finds its
 * twins above and below, and a wall split later stays inside.
 */
export const FacadeSegmentSchema = z.object({
  start: PlanPoint,
  end: PlanPoint,
  /** Unit vector out of the filled face. */
  normal: PlanPoint,
})
export type FacadeSegment = z.infer<typeof FacadeSegmentSchema>

export const FacadeAreaTargetSchema = z.discriminatedUnion('kind', [
  /** Each storey's outside loop. */
  z.object({ kind: z.literal('loop') }),
  z.object({ kind: z.literal('segments'), segments: z.array(FacadeSegmentSchema).min(1) }),
])
export type FacadeAreaTarget = z.infer<typeof FacadeAreaTargetSchema>

/** One unit of the set over a range of storeys and a part of their facade. */
export const FacadeAreaSchema = z.object({
  key: z.string().min(1),
  /** Key of the set unit it applies. */
  unit: z.string().min(1),
  /** Lowest and highest storey, inclusive, by level index. */
  from: z.string(),
  to: z.string(),
  /** Place the unit's openings, or keep the ones there and dress them. Absent means place. */
  mode: FacadeModeSchema.optional(),
  target: FacadeAreaTargetSchema,
})
export type FacadeArea = z.infer<typeof FacadeAreaSchema>

export const FacadeNode = BaseNode.extend({
  id: objectId('facade'),
  type: nodeType('facade'),
  name: z.string().default('Facade'),
  set: FacadeSetSchema,
  /** In order: a later area wins the walls it shares with an earlier one. */
  areas: z.array(FacadeAreaSchema).default([]),
  /** Attribution only: the catalog entry the set came from. */
  sourceItemId: z.string().optional(),
}).describe(
  dedent`
  Facade node - a building's facade set and where each of its units goes
  - parentId: the building
  - set: the units, each with a storey role (first / middle / top / free)
  - areas: unit key, storey range (from/to level ids) and target (each storey's outside loop, or plan segments)
  Walls keep a snapshot of the unit they carry; generated openings, panels and balconies stay owned by their wall.
  `,
)
export type FacadeNode = z.infer<typeof FacadeNode>
