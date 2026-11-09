import { z } from 'zod'

export const clearSceneTool = {
  name: 'clear_scene',
  title: 'Clear the project',
  description:
    'Empty the project on purpose, back to the default scaffold: a site, a building and one level of the standard storey height. It is the only way to empty a project: a write that would empty it is refused (scene_wipe_blocked), since that is far more often an accident. Call it only when the person asked to start over, and say what they asked in reason.',
  input: {
    reason: z.string().min(1).describe('What the person asked for, in their words.'),
  },
}
