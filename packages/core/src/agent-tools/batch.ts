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
  'get_plan_reference',
  'calibrate_plan_reference',
  'match_plan_reference',
  'survey_plan_references',
  'create_reference_elements',
  'correct_plan_reading',
  'create_stairs_and_lifts',
  'add_entry_doors',
  'describe_facade',
  'locate_photo',
  // Not propose_unit_layouts: the chat judges its layouts and reads the plan image only when it
  // is called on its own (Victor run 11 batched it and got neither).
  'apply_unit_layout',
  'name_units',
  'measure_stair',
  'fit_stair',
  'find_by_type',
  'create_roof',
  'add_wall',
  'add_level',
  'create_stair',
  'record_reference',
  'add_corner_window',
  'merge_windows',
  'add_fence',
  'add_column',
  'add_site_surface',
  'add_steps',
  'place_in_room',
  // Not search_assets: it reads the host's item library, which a host hands that one tool, and
  // already runs several queries per call. Not furnish_room or place_items, for the same library;
  // not create_room, whose answer names the floor plate and ceiling the host derives after it.
] as const

export const runBatchTool = {
  name: 'run_batch',
  title: 'Run a batch of scene tools',
  description: `Run several scene tools in one call: in order, each on the scene the calls before it left, applied as one undo step, with a report per call. Use it for what repeats or can be written in advance — the same tool on every floor, many nodes to delete, plans to rebuild with replace, a check at the end — instead of one call per step. A call cannot use an id another call of the same batch creates: take it from the report and batch again. onRefusal stop (default): a refused call stops the batch and nothing is applied; skip: the others are applied and each refusal is reported. Tools: ${BATCHABLE_TOOLS.join(', ')}.`,
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
