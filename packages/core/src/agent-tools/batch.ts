import { z } from 'zod'

/** The shared tools a batch runs; a test keeps this in step with the operations registry. */
export const BATCHABLE_TOOLS = [
  'paint',
  'search_materials',
  'list_levels',
  'get_node',
  'get_level_summary',
  'get_walls',
  'get_zones',
  'duplicate_level',
  'verify_scene',
  'delete_node',
  'measure_stair',
  'fit_stair',
  'find_by_type',
  'create_roof',
  'add_wall',
  'add_fence',
  'add_level',
  'create_stair',
  'add_corner_window',
  'merge_windows',
  'add_column',
  'place_in_room',
  // Not search_assets: it reads the host's item library, which a host hands that one tool, and
  // already runs several queries per call. Not furnish_room or place_items, for the same library;
  // not create_room, whose answer names the floor plate and ceiling the host derives after it.
] as const

export const runBatchTool = {
  name: 'run_batch',
  title: 'Run a batch of scene tools',
  description: `Optionally run several scene tools in one call: in order, each on the scene the calls before it left, applied as one undo step, with a report per call. Supports repeated or known-in-advance work; individual calls remain available. A call cannot use an id another call of the same batch creates; created ids are available in the report for subsequent calls. onRefusal stop (default): a refused call stops the batch and nothing is applied; skip: the others are applied and each refusal is reported. Tools: ${BATCHABLE_TOOLS.join(', ')}.`,
  input: {
    calls: z
      .array(
        z.object({
          tool: z.string().describe('One of the tools listed in the description.'),
          input: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("That tool's input, as when calling it on its own."),
        }),
      )
      .min(1)
      .max(64),
    onRefusal: z
      .enum(['stop', 'skip'])
      .optional()
      .describe('stop (default): nothing is applied if a call is refused. skip: apply the rest.'),
  },
}
