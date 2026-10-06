import { z } from 'zod'
import { StairDesignTargets } from '../schema/nodes/stair-design-targets'
import { NodeId } from './node-id'

export const measureStairTool = {
  name: 'measure_stair',
  title: 'Measure stair',
  description:
    'Inspect actual flight risers, walking-line going, slope, arrival, uniformity, headroom against floors, ceilings and stair bodies, and design-target diagnostics without changing measured geometry.',
  input: {
    stairId: NodeId,
    available: z.object({ width: z.number().positive(), length: z.number().positive() }).optional(),
  },
}

export const fitStairTool = {
  name: 'fit_stair',
  title: 'Fit stair',
  description:
    'Explicitly replace stair riser proportions with uniform risers from design targets. Optionally fit going by changing flight runs or arc sweep; preserves landing elevations. Optional straight, L or U layout replaces the flight chain with width-sized turning landings or quarter-turn winders. Winder going is measured along the selected walking line. One atomic edit.',
  input: {
    stairId: NodeId,
    fitRun: z.boolean().default(false),
    layout: z.enum(['straight', 'l', 'u']).optional(),
    turn: z.enum(['left', 'right']).optional(),
    width: z.number().positive().optional(),
    landingDepth: z.number().positive().optional(),
    turningStrategy: z.enum(['landing', 'winder']).optional(),
    innerGap: z.number().nonnegative().optional(),
    walkingLineOffset: z.number().positive().optional(),
    division: z.enum(['equal-going', 'equal-angle']).optional(),
    targets: StairDesignTargets.partial().optional(),
  },
}

export type MeasureStairInput = z.infer<z.ZodObject<typeof measureStairTool.input>>
export type FitStairInput = z.infer<z.ZodObject<typeof fitStairTool.input>>
