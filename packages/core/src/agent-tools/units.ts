import { z } from 'zod'
import { registerPlansGuideSection } from './guides'
import { NodeId } from './node-id'

export const nameUnitsTool = {
  name: 'name_units',
  title: 'Name apartments',
  description:
    'Name apartments as the plans number them (101, 102…), many in one call. Each apartment is named by its unit or its own zone (get_zones lists them); its zone takes the name and its rooms keep theirs after it ("101 · Bedroom 1"). Name each distinct floor before copying it: a copied floor counts on from its numbers (401 → 501).',
  input: {
    names: z
      .array(
        z.object({
          id: NodeId.describe("An apartment's unit, or its own zone."),
          name: z
            .string()
            .trim()
            .min(1)
            .max(40)
            .describe('Its name as the plan writes it: "101", "B-204".'),
        }),
      )
      .min(1)
      .max(400)
      .describe('Each apartment and its name.'),
  },
}

/** The plans guide's step 6, brought with these tools. */
registerPlansGuideSection({
  name: 'apartments',
  order: 6,
  text: '6. For an apartment building, layout, on every distinct floor, one call each for all of them: the walls of every apartment and core (walls, select apartments and cores, thinner than the exterior) — the party, corridor and core walls — and every apartment as a unit (unit, select apartments). The building map draws no rooms inside the apartments: those come from the unit plans (7). Then the entry door of every apartment on those floors: add_entry_doors, in the wall onto the corridor, never into a core. Name the apartments as the plan numbers them (name_units, a whole floor in one call: 101, 102…). After the stairs and lifts (8), the circulation issues of verify_scene (door_leads_nowhere, lift_door_blocked, stair_has_no_landing, no_exterior_door, apartment_unreachable) say what cannot be reached from the entrance; move a guessed door rather than keep it.',
})
