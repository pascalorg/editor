import { z } from 'zod'
import { NodeId } from './node-id'

export const REFERENCE_ITEM_KINDS = [
  'volume',
  'opening',
  'material',
  'roof',
  'fixture',
  'screen',
  'soffit',
  'paving',
  'planting',
  'fence',
  'signage',
  'style',
  'other',
] as const

export const recordReferenceTool = {
  name: 'record_reference',
  title: 'Write down what a reference shows',
  description:
    "Write down what a reference image shows, item by item, as you read it: the volumes, the openings and their panes, the materials, the roof's edges, the fixtures (lights, a house number), screens, the soffit, steps and paving, planting, fences, signage, and the style the faces it does not show should follow. The image is the specification: verify_scene lists every item not built yet (inventoryUnbuilt). Call again as you build: an item is built with the nodes that build it (nodeIds), approximated with the nodes that stand in for it when they differ from the image (compare a close-up before calling it built), or not_possible with why (a missing tool is worth saying). An approximated or not possible item a tool can still build comes back with that tool (stillBuildable): build it rather than leave it. Items keep their id: a call adds them or updates them. Nothing requires it.",
  input: {
    image: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        'The reference the items come from, as you name it: "facade photo", a plan\'s guide id.',
      ),
    items: z
      .array(
        z.object({
          id: z
            .string()
            .regex(/^[a-z0-9_-]{1,60}$/)
            .describe('Your name for the item, to update it later: "wall_lights".'),
          kind: z.enum(REFERENCE_ITEM_KINDS),
          what: z.string().trim().min(1).max(200).describe('What it is, as the image shows it.'),
          where: z
            .string()
            .trim()
            .max(120)
            .optional()
            .describe('The face, storey or room it is on: "front, ground floor".'),
          count: z.number().int().min(1).max(500).optional(),
          status: z
            .enum(['to_build', 'built', 'approximated', 'not_possible'])
            .default('to_build')
            .describe(
              'to_build (default), built (with nodeIds), approximated (with the nodeIds standing in), or not_possible (with why).',
            ),
          nodeIds: z.array(NodeId).min(1).max(50).optional().describe('The nodes that build it.'),
          why: z
            .string()
            .trim()
            .max(300)
            .optional()
            .describe('Why it cannot be built: the tool or type Pascal lacks.'),
        }),
      )
      .min(1)
      .max(100),
  },
}
