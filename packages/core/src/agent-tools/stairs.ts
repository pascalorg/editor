import { z } from 'zod'
import { levelTarget } from './levels'
import { measurement } from './measurement'
import { NodeId } from './node-id'

export const createStairTool = {
  name: 'create_stair',
  title: 'Create stair',
  description:
    "Create a straight staircase rising from a level to the level above, as the editor's stair tool does: it owns the floor opening it cuts in every floor it passes, and when no level stands above, a blank one is created for it. Refused with a code: a flight to or from a declared roof level, and a toLevelId that is not above the level it rises from.\n\nGEOMETRY (get this wrong and the stair pokes through a wall):\n- (x, z) is the BACK-CENTRE of the first (bottom) step, not the centre of the footprint.\n- The footprint is width × length: width side to side, length along the climb. At rotation 0 it covers x − width/2 .. x + width/2 and z .. z + length.\n- rotation in degrees about Y: 0 climbs toward +Z, 90 → +X, 180 → −Z, 270 → −X. Point the climb into the room, away from the wall the bottom step sits against.\n- Leave at least 0.5 m clear at the foot of the flight, and keep the whole footprint inside one room on both levels (a hall is typical): read the room's outline first (get_zones).",
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
      description: 'Horizontal run along the climb (default 3.0 m).',
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
  },
}
