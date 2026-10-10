import { z } from 'zod'
import { registerPlansGuideSection } from './guides'
import { NodeId } from './node-id'

const count = (most: number) => z.number().int().min(0).max(most)

const brief = {
  bedrooms: count(6).describe('Bedrooms, as the plan image reads or the person asks.'),
  bathrooms: z.number().int().min(1).max(4).describe('Bathrooms.'),
  rooms: z
    .object({
      walk_in: count(2).optional(),
      laundry: count(1).optional(),
      pantry: count(1).optional(),
      closet: count(3).optional(),
    })
    .optional()
    .describe(
      'Optional rooms the plan shows or the person wants, by count; 0 keeps one out, a room left out may or may not appear.',
    ),
}

export const proposeUnitLayoutsTool = {
  name: 'propose_unit_layouts',
  title: 'Propose interior layouts for apartment units',
  description:
    "Propose credible interior layouts (rooms, interior walls, doors) for an apartment unit that has none, or for a group of congruent units at once: units with no readable plan, an imaginary building's apartments, or a unit whose plan is a picture. It generates thousands of layouts inside the unit's outline, keeps the ones that pass the hard rules (every room reachable, minimum widths, the entry on the entry wall), orders them by how well they match the unit's plan image when one is given (a bedroom the plan draws inside, with no window, can win), else by how few problems code finds (a bedroom with no window ranks after every lit one), filters out the ones a client would clearly refuse, and returns 3–4 that differ: their rooms with areas, what code measured about each, the main weakness, and a drawing each. Read-only: show the drawings, let the person choose, then apply_unit_layout with the chosen one's `applyWith`. Without a plan image, say the layouts are guesses. Refuses a slanted or curved outline and a program that cannot fit the unit's area.",
  input: {
    unitIds: z
      .array(NodeId)
      .min(1)
      .max(60)
      .describe(
        'The units to fill: one apartment zone, or a group of congruent ones (survey_plan_references groups them). The first is laid out; the others take the same layout turned or mirrored to fit.',
      ),
    ...brief,
    planGuideId: NodeId.optional().describe(
      "The unit's plan reference (an imported JPG or PNG unit plan), when it has one: layouts are ordered by how closely their walls match its drawing.",
    ),
    seed: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe('Draws another set of layouts.'),
  },
}

export const applyUnitLayoutTool = {
  name: 'apply_unit_layout',
  title: 'Apply a proposed unit layout',
  description:
    "Build one layout from propose_unit_layouts into its units: a zone per room, the interior walls and the doors, in one undo step, every node marked as guessed. Congruent units get it turned or mirrored to fit, with the entry door on each unit's own entry wall. Pass the finalist's `applyWith` unchanged. Only once the person has chosen this layout or said yes to applying it: without their yes it refuses (needs_consent). Returns per unit what was asked and what was built, and refuses when nothing could be built or a unit has changed since the proposal.",
  input: {
    unitIds: z.array(NodeId).min(1).max(60).describe('The units, as proposed.'),
    layoutId: z.string().min(1).describe('The chosen finalist, as proposed.'),
    ...brief,
    seed: z.number().int().min(1).max(1_000_000).optional(),
    spaceKey: z
      .string()
      .optional()
      .describe('As proposed: tells a unit that changed since the proposal, which is refused.'),
    replaceGuess: z
      .boolean()
      .optional()
      .describe(
        'Replace a layout guessed earlier in these units; only nodes marked as guessed go.',
      ),
    consent: z
      .boolean()
      .describe(
        'true only when the person chose this layout or said yes to applying it in this conversation.',
      ),
  },
}

/** The plans guide's step 7, brought with these tools. */
registerPlansGuideSection({
  name: 'interiors',
  order: 7,
  text: "7. For an apartment building, interiors: each unit plan into every apartment it fits, mirrored and turned ones included, in one call — create_reference_elements with into: 'fits' and the unit plan's wall lines as shapeIds (its thickest line group; every line would turn fixtures into walls). Then the doors (add_door): one per room; the entry doors are step 6's (add_entry_doors). Apartments with no unit plan, or whose plan is only a picture: propose_unit_layouts for each group of congruent apartments (the first and the ones its plan fits; a picture goes as planGuideId), show the person the drawings and ask which one, then apply_unit_layout with that finalist's applyWith and consent: true. Say they are guesses.",
})
