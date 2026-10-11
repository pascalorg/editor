import { z } from 'zod'
import { NodeId } from './node-id'

export const findByTypeTool = {
  name: 'find_by_type',
  title: 'Find by type',
  description:
    "Find everything of one type in the scene, wherever it lives: nodes of that kind (column, door, window, wall, stair…), items of that category, lights (any item that emits light), and typed parts inside scripted objects, windows and doors (a porch's columns, a window's grille). Parts are read-only: they come back with their object's id, the part id and, for objects directly on a level, its bounds in level coordinates; edit them through their object.",
  input: {
    type: z
      .string()
      .min(1)
      .describe('What to find, one word: light, column, door, window, beam, panel, railing, trim…'),
    levelId: NodeId.optional().describe('Only this level. Default: every level.'),
  },
}
