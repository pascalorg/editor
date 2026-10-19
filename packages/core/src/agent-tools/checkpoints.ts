import { z } from 'zod'

/**
 * `set_checkpoint`'s contract: the agent names a moment of its build, to look back from.
 */
export const setCheckpointTool = {
  name: 'set_checkpoint',
  title: 'Set a checkpoint',
  description:
    'A named moment in your work (a roof, a floor, a batch of walls) that verify_scene({ since: name }) can compare against: it lists what was created, changed and deleted since, grouped by level and kind with a view each, and what you made that is gone. "start", the beginning of your work, is always one; a name used again replaces the first; a session keeps at most 8. A checkpoint is kept with your session, not in the project: it changes nothing in the scene, enters no undo, and does not restore anything. Refused: too_many_checkpoints (naming them), scene_too_large, name_required.',
  input: {
    name: z
      .string()
      .min(1)
      .max(40)
      .describe('A short name for this moment, e.g. "walls done" or "before roof".'),
  },
}
