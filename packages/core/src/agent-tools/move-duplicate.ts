import { z } from 'zod'
import { achievedOutput } from './achieved'
import { NodeId } from './node-id'

// Arrays avoid tuple-form JSON schemas that some MCP clients cannot call.
const planPoint = z.array(z.number()).length(2)

export const moveNodeTool = {
  name: 'move_node',
  title: 'Move node',
  description:
    "Move one node the way the editor's move tool does, re-seated on its host: a door, window or wall item slides along its wall (the plan point is projected onto the wall, clamped to stay on it, and refused with opening_overlap where it would hit a sibling, unless force, like holding Alt); a ceiling item moves in plan under its ceiling, keeping its drop; a floor or free node moves in plan on its level, keeping its height; a roof piece (skylight, chimney, vents, solar, dormer) moves in its segment-local plan, the frame its stored position uses, its height staying anchored to the segment surface; a wall takes by only (its ends translate, its openings ride in their wall-local seats). to and by are plan metres [x, z]: level plan for level, wall and ceiling hosts, segment-local for a roof host. Exactly one of to (absolute) or by (delta), or rotation alone. y is a window's sill height or a wall item's bottom height in metres, and nothing else takes it. rotation is yaw in degrees for free, ceiling and roof nodes. Returns the host class and id, the node's stored position after the move (a wall: its start point as [x, 0, z]), and whether the seat clamped. Refusals: node_not_found, node_not_movable (site, building, level, zone — use move_zone — roof, roof segment, stair, derived plates and other geometry-defined kinds), move_target_required, move_target_ambiguous (both to and by, or to on a wall), move_host_missing (its wall, ceiling or segment is gone), curved_wall, wall_too_short, wall_too_low, opening_overlap, rotation_not_supported (wall-hosted nodes face their wall side), height_not_applicable, move_not_supported (an item resting on another item).",
  input: {
    id: NodeId.describe('The node id.'),
    to: planPoint
      .optional()
      .describe(
        'Absolute plan target [x, z] in metres, in the frame the description names for its host.',
      ),
    by: planPoint
      .optional()
      .describe('Plan delta [dx, dz] in metres from where the node sits, same frame as to.'),
    y: z
      .number()
      .optional()
      .describe(
        "A window's sill height or a wall item's bottom height above the floor, in metres.",
      ),
    rotation: z.number().optional().describe('Yaw in degrees (free, ceiling and roof nodes).'),
    force: z
      .boolean()
      .optional()
      .describe('Allow a wall seat that overlaps a sibling, like holding Alt in the editor.'),
  },
}

export const moveNodeOutput = {
  ok: z.literal(true),
  id: z.string(),
  type: z.string(),
  host: z.enum(['wall', 'ceiling', 'free', 'roof', 'level']),
  hostId: z.string().nullable(),
  position: z.array(z.number()).length(3),
  clamped: z.boolean(),
  message: z.string(),
  achieved: achievedOutput,
}

export const duplicateNodeTool = {
  name: 'duplicate_node',
  title: 'Duplicate node',
  description:
    "Duplicate nodes with everything under them, as the editor's Duplicate does: fresh ids, hosted children re-hosted on the copies (a wall brings its doors, windows and wall items, their wallId pointing at the copy), an id inside another listed subtree skipped rather than copied twice. A door, window, wall item, ceiling item or roof piece copied on its own stays on its same host. offset [dx, dz] in plan metres moves every copy from its source's seat (default [0, 0], an exact copy in place, as the editor's duplicate starts); a wall offset translates its ends, a hosted copy's offset slides it on its host, clamped to stay seated. targetLevelId puts level-parented copies on that level instead; a hosted copy refuses it (hosted_root_level) because its host stays behind. Returns copies (sourceId, copyId, type, descendantCount), totalCreated and skippedIds. Refusals: node_not_found, duplicate_not_supported (a site, building, level — use duplicate_level — zone — use duplicate_zone — roof or roof segment, or a derived plate), duplicate_root_invalid (a node the editor only copies as part of its parent), hosted_root_level, level_not_found.",
  input: {
    ids: z
      .array(NodeId)
      .min(1)
      .max(64)
      .describe('The node ids to copy, each with everything under it.'),
    offset: planPoint
      .optional()
      .describe('Plan delta [dx, dz] in metres applied to every copy. Default [0, 0].'),
    targetLevelId: NodeId.optional().describe(
      'Copy level-parented roots onto this level instead of their own.',
    ),
  },
}

export const duplicateNodeOutput = {
  ok: z.literal(true),
  copies: z.array(
    z.object({
      sourceId: z.string(),
      copyId: z.string(),
      type: z.string(),
      descendantCount: z.number().int(),
    }),
  ),
  totalCreated: z.number().int(),
  skippedIds: z.array(z.string()),
  message: z.string(),
  achieved: achievedOutput,
}
