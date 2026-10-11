import { z } from 'zod'

/**
 * `set_checkpoint`'s contract: the agent names a moment of its build, to look back from.
 */
export const setCheckpointTool = {
  name: 'set_checkpoint',
  title: 'Set a checkpoint',
  description:
    'Name this moment of your build before you start something you may need to look back on: a roof, a floor, a batch of walls. verify_scene({ since: name }) then lists what was created, changed and deleted since, grouped by level and kind with a view each, what you made that is gone, and the coherence items introduced and resolved since. "start", the beginning of your work, is always one; a name used again replaces the first; a session keeps at most 8. A checkpoint is kept with your session, not in the project: it changes nothing in the scene, enters no undo, and does not restore anything. Refused: too_many_checkpoints (naming them), scene_too_large, name_required.',
  input: {
    name: z
      .string()
      .min(1)
      .max(40)
      .describe('A short name for this moment, e.g. "walls done" or "before roof".'),
  },
}
