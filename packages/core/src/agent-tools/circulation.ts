import { z } from 'zod'
import { registerPlansGuideSection } from './guides'
import { NodeId } from './node-id'

export const createStairsAndLiftsTool = {
  name: 'create_stairs_and_lifts',
  title: 'Create stairs and lifts from plan cores',
  description:
    "Build the stairs and lifts of a building from the cores its floor plan draws: in each stair core a stair between every pair of floors (a switchback when two flights fit across it, else one straight flight), in each lift core one lift serving every floor, their floor openings cut. Name each core's kind from the plan: stairs draw their treads, lifts are often marked E or LIFT; a trash room or shaft is neither. The floors are the plan's floor and every floor above it with a slab, unless levelIds says otherwise; build the slabs first. A core that already holds a stair or lift is skipped, so a repeat is safe; a core too small for a stair is reported. Walls the plan drew inside a core (its flights, a divider) are cleared on every floor it serves (wallsCleared); a wall running into a stair core is reported (overlaps), not removed. Name the core, not a flight: a flight named instead stands for the core around it (resolved).",
  input: {
    guideId: NodeId.describe('The calibrated floor plan the cores are drawn on.'),
    cores: z
      .array(
        z.object({
          shapeId: z.string().describe('The core shape id on the plan (survey cores or contours).'),
          kind: z.enum(['stair', 'lift']),
        }),
      )
      .min(1)
      .max(32),
    levelIds: z
      .array(NodeId)
      .min(1)
      .max(64)
      .optional()
      .describe(
        'The floors to connect, any order. Default: the plan’s floor and every floor above it with a slab.',
      ),
  },
}

/** The plans guide's step 8, brought with these tools. */
registerPlansGuideSection({
  name: 'copies',
  order: 8,
  text: "8. For an apartment building, copy last (a copy numbers its apartments for its floor: 401 becomes 501). When a family's first floor has its interiors and doors (and its facade when applied floor by floor with apply_facade; a facade set goes on after the copies), delete the levels that hold only its family's other plans, then duplicate_level it once per floor: each copy goes right above its original, taking the floor you freed; only floors in the way move up, so the floors above the family keep their index. Copy from the top down: the first copy takes the name of the family's highest floor. Then the stairs and lifts: create_stairs_and_lifts on the lowest floor's plan, each core named stair or lift from the drawing (treads; E or LIFT; a trash room is neither), connects every floor with a slab in one call, and clears the walls the plan drew inside a core; a core read as an apartment becomes a common core, and each landing gets its door onto the corridor. A short_landing it reports (a tall storey in a short core) is for the person: say it, do not rebuild around it.",
})
