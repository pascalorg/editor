import { z } from 'zod'
import { StairDesignTargets } from '../schema/nodes/stair-design-targets'
import { levelTarget } from './levels'
import { measurement } from './measurement'
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

export const createStairTool = {
  name: 'create_stair',
  title: 'Create stair',
  description:
    "Create a straight staircase rising from a level to the level above, as the editor's stair tool does: it owns the floor opening it cuts in every floor it passes, and when no level stands above, a blank one is created for it. Refused with a code: a flight to or from a declared roof level, and a toLevelId that is not above the level it rises from.\n\nGEOMETRY (get this wrong and the stair pokes through a wall):\n- (x, z) is the BACK-CENTRE of the first (bottom) step, not the centre of the footprint.\n- The footprint is width × length: width side to side, length along the climb. At rotation 0 it covers x − width/2 .. x + width/2 and z .. z + length.\n- rotation in degrees about Y: 0 climbs toward +Z, 90 → +X, 180 → −Z, 270 → −X. Point the climb into the room, away from the wall the bottom step sits against.\n- Leave at least 0.5 m clear at the foot of the flight, and keep the whole footprint inside one room on both levels (a hall is typical): read the room's outline first (get_zones).\n\nOPENINGS: by default the stair owns the opening over its flight and keeps it as the flight moves (openingOffset widens it). An opening of another size, centre or turn, through a slab or ceiling you name, or through one of the two only, is cut as an opening the stair owns, as given.",
  input: {
    x: z.number().describe('X of the back-centre of the first step.'),
    z: z.number().describe('Z of the back-centre of the first step.'),
    rotation: measurement('angle', 'deg', {
      description: 'The climb direction (default 0 = toward +Z; 90 = +X, 180 = −Z, 270 = −X).',
    }).optional(),
    width: measurement('length', 'm', {
      positive: true,
      description: 'Side-to-side width, across the climb (default 1.0 m).',
    }).optional(),
    length: measurement('length', 'm', {
      positive: true,
      description:
        "Horizontal run along the climb (default: from the stair's design targets, 0.28 m of going per riser, risers of at most 0.18 m).",
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description:
        "Vertical rise. Omit it unless asked for a specific rise: the flight then follows the storey's floor-to-floor height and keeps tracking it.",
    }).optional(),
    steps: z
      .number()
      .int()
      .min(3)
      .optional()
      .describe(
        'Number of risers. Omit it to derive ~18 cm risers from the rise; pass it when the run was planned from a step count.',
      ),
    ...levelTarget,
    toLevelId: NodeId.optional().describe(
      'The level the flight arrives on. Default: the next level above, created when there is none.',
    ),
    railingMode: z
      .enum(['none', 'left', 'right', 'both'])
      .optional()
      .describe('Which sides have a railing, looking up the flight (default both).'),
    materialPreset: z
      .string()
      .optional()
      .describe('A library material for the flight (library:<id>); an unknown one is refused.'),
    name: z.string().optional().describe('Its name (default Staircase N).'),
    createDestinationSlabOpening: z
      .boolean()
      .optional()
      .describe('Cut the floor it arrives through (default true).'),
    createSourceCeilingOpening: z
      .boolean()
      .optional()
      .describe('Cut the ceiling of the floor it leaves (default true).'),
    destinationSlabId: NodeId.optional().describe(
      'The slab it arrives through. Default: the floor of the level it arrives on.',
    ),
    sourceCeilingId: NodeId.optional().describe(
      'The ceiling it rises through. Default: the ceiling of the level it leaves.',
    ),
    openingWidth: measurement('length', 'm', {
      positive: true,
      description: 'The opening across the climb (default the flight width).',
    }).optional(),
    openingLength: measurement('length', 'm', {
      positive: true,
      description: 'The opening along the climb (default the run length).',
    }).optional(),
    openingOffset: measurement('length', 'm', {
      min: 0,
      description: 'A margin round the opening on every side (default 0.08 m).',
    }).optional(),
    openingCenter: z
      .array(z.number())
      .length(2)
      .optional()
      .describe('The opening centre (x, z). Default: the middle of the flight.'),
    openingRotation: measurement('angle', 'deg', {
      description: "The opening's turn (default the flight's).",
    }).optional(),
  },
}

export type MeasureStairInput = z.infer<z.ZodObject<typeof measureStairTool.input>>
export type FitStairInput = z.infer<z.ZodObject<typeof fitStairTool.input>>
