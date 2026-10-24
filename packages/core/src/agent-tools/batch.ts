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
  // The host compiles each module before the batch runs.
  'add_object',
  'place_design',
  'place_in_room',
  // Not search_assets: it reads the host's item library, which a host hands that one tool, and
  // already runs several queries per call. Not view_assets, whose pictures a batch's result cannot
  // carry (it returns each call's result as data; a picture rides beside the result of a call
  // made on its own). Not furnish_room or place_items, for the same library;
  // not create_room, whose answer names the floor plate and ceiling the host derives after it.
] as const

/**
 * Batched tools whose calls do not depend on each other: one that fails is reported with its own
 * error and the others are applied, whatever onRefusal says. An authored object is made whole or
 * not at all, and ten of them in one batch should not be lost to one script that does not run.
 */
export const INDEPENDENT_BATCH_TOOLS: readonly string[] = ['add_object']

export const runBatchTool = {
  name: 'run_batch',
  title: 'Run a batch of scene tools',
  description: `Optionally run several scene tools in one call: in order, each on the scene the calls before it left, applied as one undo step, with a report per call. Supports repeated or known-in-advance work; individual calls remain available. A call cannot use an id another call of the same batch creates; created ids are available in the report for subsequent calls. onRefusal stop (default): a refused call stops the batch and nothing is applied; skip: the others are applied and each refusal is reported; add_object calls are independent of each other under both: one that fails is reported with its own error and the others are applied, each with the receipt a single add_object gives. Tools: ${BATCHABLE_TOOLS.join(', ')}.`,
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
