import { z } from 'zod'
import { NodeId } from './node-id'

export const findByTypeTool = {
  name: 'find_by_type',
  title: 'Find by type',
  description:
    "Find everything of one type in the scene, wherever it lives: nodes of that kind (column, door, window, wall, stair, imported-mesh, a plugin's kind…), items of that category, lights (any item that emits light), and typed parts inside scripted objects, windows and doors (a porch's columns, a window's grille). Narrow it to a level, a parent, a zone or an importer's source ids; without a type, every node the other filters match. Each result gives the node's id, name, kind, level and parent, with its metadata and provenance when it has them; get_node reads one whole. Parts are read-only: they come back with their object's id, the part id and, for objects directly on a level, its bounds in level coordinates; edit them through their object.",
  input: {
    type: z
      .string()
      .min(1)
      .optional()
      .describe(
        'What to find, one word: a node kind (wall, slab, imported-mesh, fixture:bench), an item category, light, or a part type (column, beam, panel, railing, trim…). Omit it to find every node the other filters match.',
      ),
    levelId: NodeId.optional().describe('Only this level. Default: every level.'),
    parentId: NodeId.optional().describe(
      "Only the nodes directly under this one: a wall's doors and windows, a roof's segments, a level's walls.",
    ),
    zoneId: NodeId.optional().describe(
      "Only what stands in this zone: on the zone's level, its plan point inside the zone (a wall's midpoint, a polygon's centroid, a door or window where its wall puts it, a block or mesh by the middle of its geometry).",
    ),
    sourceId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Only the nodes an importer recorded under this source id (provenance.refs[].id, or legacy metadata.sourceIds), exactly. Characters outside printable ASCII also match their percent-encoded form.',
      ),
    sourceIdPrefix: z
      .string()
      .min(1)
      .optional()
      .describe('Only the nodes with a source id starting with this.'),
  },
}
