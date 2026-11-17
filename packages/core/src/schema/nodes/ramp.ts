import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const Point = z.tuple([z.number().finite(), z.number().finite()])
const HeightUnit = z.number().int().min(-32768).max(32767)
const TerrainEffect = z.object({
  siteId: z.string(),
  origin: Point,
  spacing: z.number().finite().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  step: z.number().finite().positive(),
  samples: z.array(z.tuple([z.number().int().nonnegative(), HeightUnit, HeightUnit])),
})

export const RampSegment = z.discriminatedUnion('type', [
  z.object({ type: z.literal('line'), end: Point }),
  z.object({ type: z.literal('arc'), center: Point, sweep: z.number().finite() }),
])
export type RampSegment = z.infer<typeof RampSegment>

/** Centreline and surface heights are in the owning Site's frame, in metres. */
export const RampNode = BaseNode.extend({
  id: objectId('ramp'),
  type: nodeType('ramp'),
  start: Point,
  segments: z.array(RampSegment).min(1).max(128),
  width: z.number().finite().positive().default(3),
  startHeight: z.number().finite().default(0),
  endHeight: z.number().finite(),
  thickness: z.number().finite().positive().default(0.15),
  startTransition: z.number().finite().nonnegative().default(0),
  endTransition: z.number().finite().nonnegative().default(0),
  maxSlopePercent: z.number().finite().positive().default(18),
  use: z.enum(['vehicle', 'pedestrian']).default('vehicle'),
  startTargetId: z.string().optional(),
  endTargetId: z.string().optional(),
  terrainMode: z.enum(['cut-fill', 'none']).default('cut-fill'),
  retainingHeight: z.number().finite().nonnegative().default(0),
  terrainEffect: TerrainEffect.optional(),
  slots: z.record(z.string(), z.string()).default({}),
})
export type RampNode = z.infer<typeof RampNode>
