import { z } from 'zod'
import { NodeId } from './node-id'

/** Results a call lists when it names no limit; past it they are counted, not listed. */
export const FIND_BY_TYPE_LIMIT = 200

export const findByTypeTool = {
  name: 'find_by_type',
  title: 'Find by type',
  description: `Find everything of one type in the scene, wherever it lives: nodes of that kind (column, door, window, wall, stair, imported-mesh, a plugin's kind…), items of that category, lights (any item that emits light), and typed parts inside scripted objects, windows and doors (a porch's columns, a window's grille). Narrow it to a level, a parent, a zone or an importer's source ids; without a type, every node the other filters match. A word that names nothing (no node kind, nor an item category or part type in this scene) is refused with the kinds the scene holds. Each result gives the node's id, name, kind, level and parent, with its metadata and provenance when it has them (one over 1 KB is named in omitted instead); get_node reads a node whole. Parts are read-only: they come back with their object's id, the part id and, for objects directly on a level, its bounds in level coordinates; edit them through their object. count says how many match; past limit (${FIND_BY_TYPE_LIMIT} unless asked) the rest are left out of results, with truncated: narrow the call or raise limit.`,
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
      "Only what stands in this zone: on the zone's level, its plan point inside the zone's outline and outside its holes (a wall's midpoint, a polygon's centroid, a door or window where its wall puts it, a block or mesh by the middle of its geometry, a part with bounds by their middle).",
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
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        `How many results to list at most. Default ${FIND_BY_TYPE_LIMIT}; count still says how many match.`,
      ),
  },
}
