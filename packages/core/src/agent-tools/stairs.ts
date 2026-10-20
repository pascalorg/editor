import { z } from 'zod'
import { StairRailingMode, StairRailingStyle } from '../schema/nodes/stair-types'
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
    available: z
      .object({
        width: measurement('length', 'm', { positive: true }),
        length: measurement('length', 'm', { positive: true }),
      })
      .optional()
      .describe('The space a new layout may take, to propose layouts that fit it.'),
  },
}

/** A stair's design targets, each in metres; only the ones given change. */
const designTargets = z.object({
  maxRiserHeight: measurement('length', 'm', {
    positive: true,
    description: 'The tallest riser (default 0.18 m).',
  }).optional(),
  minimumGoing: measurement('length', 'm', {
    positive: true,
    description: 'The shortest going (default 0.25 m).',
  }).optional(),
  targetGoing: measurement('length', 'm', {
    positive: true,
    description: 'The going a fit aims for (default 0.28 m).',
  }).optional(),
  minimumHeadroom: measurement('length', 'm', {
    positive: true,
    description: 'The least headroom over the flight (default 2 m).',
  }).optional(),
})

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
    width: measurement('length', 'm', { positive: true }).optional(),
    landingDepth: measurement('length', 'm', { positive: true }).optional(),
    turningStrategy: z.enum(['landing', 'winder']).optional(),
    innerGap: measurement('length', 'm', { min: 0 }).optional(),
    walkingLineOffset: measurement('length', 'm', { positive: true }).optional(),
    division: z.enum(['equal-going', 'equal-angle']).optional(),
    targets: designTargets.optional(),
  },
}

export const createStairTool = {
  name: 'create_stair',
  title: 'Create stair',
  description:
    "Create a staircase rising from a level, as the editor's stair tool builds one: straight, L (a flight, a landing as deep as the stair is wide, a flight turned 90°) or U (a flight, a landing across, a flight back beside the first). It rises to the level above and owns the floor opening it cuts in every floor it passes; when no level stands above, a blank one is made for it. toLevelId null makes a flight to no level (porch steps, a deck, a raised platform): it rises height, cuts nothing and makes no level. Refused with a code: a flight to or from a declared roof level, and a toLevelId that is not above the level it rises from.\n\nGEOMETRY (get this wrong and the stair pokes through a wall):\n- (x, z) is the middle of the bottom riser, where the flight starts. The first flight runs from there along the climb: at rotation 0 it covers x − width/2 .. x + width/2 and z .. z + its run.\n- rotation in degrees about Y: 0 climbs toward +Z, 90 → +X, 180 → −Z, 270 → −X. Point the climb into the room, away from the wall the bottom step sits against.\n- An L or U turns to the climber's left or right (turn). The result gives the whole footprint and the point the top step arrives at.\n- Keep 0.9 m clear at the foot and at the head of the flight, and the whole footprint inside one room on both levels (a hall is typical): read the room's outline first (get_zones).\n\nOPENINGS: by default the stair owns the opening over its flights and keeps it as the stair moves (openingOffset widens it). An opening of another size, centre or turn, through a slab or ceiling you name, or through one of the two only, is cut as an opening the stair owns, as given.",
  input: {
    x: z.number().describe('X of the middle of the bottom riser.'),
    z: z.number().describe('Z of the middle of the bottom riser.'),
    rotation: measurement('angle', 'deg', {
      description: "The first flight's climb (default 0 = toward +Z; 90 = +X, 180 = −Z, 270 = −X).",
    }).optional(),
    layout: z
      .enum(['straight', 'l', 'u'])
      .optional()
      .describe(
        'straight (default); l: a flight, a landing, a flight turned 90°; u: a flight, a landing across, a flight back beside the first.',
      ),
    turn: z
      .enum(['left', 'right'])
      .optional()
      .describe("Which way an L or U turns, to the climber's left or right (default left)."),
    lowerSteps: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("An L or U's risers in the first flight; the rest are in the last (default half)."),
    width: measurement('length', 'm', {
      positive: true,
      description: 'Side-to-side width, across the climb (default 1.0 m).',
    }).optional(),
    length: measurement('length', 'm', {
      positive: true,
      description:
        "The flights' horizontal run along the climb, landings aside (default: from the stair's design targets, 0.28 m of going per riser, risers of at most 0.18 m).",
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description:
        "Vertical rise. Omit it unless asked for a specific rise: the flight then follows the storey's floor-to-floor height and keeps tracking it.",
    }).optional(),
    steps: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe(
        'Number of risers in all. Omit it to derive ~18 cm risers from the rise; pass it when the run was planned from a step count.',
      ),
    ...levelTarget,
    toLevelId: NodeId.nullable()
      .optional()
      .describe(
        "The level the flight arrives on. Default: the next level above, created when there is none. null: a flight to no level, rising height (default the storey's floor-to-floor height).",
      ),
    railingMode: StairRailingMode.optional().describe(
      'Which sides have a railing, looking up the flight (default both).',
    ),
    railingStyle: StairRailingStyle.optional().describe(
      'How the railings are built (default balusters): post-and-rail, cable (contemporary with a black railingMaterial), boards, glass or metal.',
    ),
    railingMaterial: z
      .string()
      .optional()
      .describe('A library material for the railings (library:<id>); an unknown one is refused.'),
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
      description: "The opening across the climb (default the stair's footprint).",
    }).optional(),
    openingLength: measurement('length', 'm', {
      positive: true,
      description: "The opening along the climb (default the stair's footprint).",
    }).optional(),
    openingOffset: measurement('length', 'm', {
      min: 0,
      description: 'A margin round the opening on every side (default 0.08 m).',
    }).optional(),
    openingCenter: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("The opening centre (x, z). Default: the middle of the stair's footprint."),
    openingRotation: measurement('angle', 'deg', {
      description: "The opening's turn (default the stair's).",
    }).optional(),
  },
}

export type MeasureStairInput = z.infer<z.ZodObject<typeof measureStairTool.input>>
export type FitStairInput = z.infer<z.ZodObject<typeof fitStairTool.input>>
export type CreateStairInput = z.infer<z.ZodObject<typeof createStairTool.input>>
