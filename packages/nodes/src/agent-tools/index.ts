import { measurement, type PluginAgentTools } from '@pascal-app/core/agent-tools'
import { z } from 'zod'

export const finishKitchenRunTool = {
  name: 'kitchen_finish_run' as const,
  title: 'Finish kitchen run',
  description:
    'Align a cabinet run or fit wall fillers. align matches base heights, backs, reveals and handles while preserving tall appliances, compartments and hosted-item support. fill closes 50–150 mm gaps at exposed ends beside perpendicular walls without moving existing modules. Repeating fill is a no-op. Refuses cabinet_run_not_found or hosted_items_unsupported. One undo step.',
  input: { runId: z.string(), action: z.enum(['align', 'fill']) },
  runsIn: 'operation' as const,
}
export const checkKitchenClearanceTool = {
  name: 'kitchen_check_clearance' as const,
  title: 'Check kitchen opening clearance',
  description:
    'Check a cabinet run or module for advisory door and drawer opening clearance against visible floor-placed objects and straight walls on its level. Accounts for hosting transforms and floor support. Conservative envelopes, not exact hinge sweeps; curved walls and wall openings are not resolved. Does not change the scene. Requires the scene’s node definitions in the registry; refuses cabinet_not_found or node_capability_unavailable.',
  input: { nodeId: z.string() },
  runsIn: 'operation' as const,
}
export const editDuctTool = {
  name: 'duct_edit' as const,
  title: 'Resize or offset duct',
  description:
    "Resize a duct segment or branch, or offset a straight horizontal run around an obstacle with four elbows, keeping connected collars joined. resize: scope defaults to segment; branch follows the same profile through elbows, couplings, dampers and caps, stopping at junctions, profile changes and equipment. Transitions are inserted at the fixed collars where the resize stops. shape, diameter, width and height default to the run's current values. alignment defaults to center, which supports connected runs; top, bottom, left and right need a free straight run. offset: from and to are the first and last bend positions in metres from the start, and offset is the signed vertical displacement in metres; all three are required, and both original endpoints stay fixed. Does not detect obstacles: check clearance. Refuses duct_not_found, node_capability_unavailable, duct_profile_invalid, duct_alignment_anchored, duct_connection_ambiguous, duct_clearance, duct_offset_route, duct_offset_roll, duct_offset_attachments, duct_offset_clearance or duct_offset_angle without partial edits. One undo step.",
  input: {
    nodeId: z.string(),
    action: z.enum(['resize', 'offset']),
    scope: z.enum(['segment', 'branch']).optional(),
    alignment: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional(),
    shape: z.enum(['round', 'rect', 'oval']).optional(),
    diameter: measurement('length', 'in').optional(),
    width: measurement('length', 'in').optional(),
    height: measurement('length', 'in').optional(),
    offset: measurement('length', 'm').optional(),
    from: measurement('length', 'm').optional(),
    to: measurement('length', 'm').optional(),
  },
  runsIn: 'operation' as const,
}
export const pipeGradeTool = {
  name: 'pipe_grade' as const,
  title: 'Edit pipe grade and elevation',
  description:
    "Set a pipe run's grade or flow direction, move one of its path points, or change its elevation, keeping connected pipes and fittings joined. grade: gradePercent is the percent fall over horizontal travel; flow defaults to forward (falling from start to end), and reverse falls toward the start; anchor defaults to start, the end that keeps its elevation. endpoint: moves path point pointIndex to point, a numeric [x, y, z] tuple in level-local metres (not a unit-bearing length string), preserving each existing leg grade; connected runs and end caps follow unless detach is true (default false), which leaves them in place. elevation: sets the anchor end (default start) to elevation above the level and translates the whole run without changing grades. Vertical legs keep their rise. Refuses pipe_not_found, node_capability_unavailable, pipe_grade_invalid, pipe_elevation_invalid, pipe_endpoint_invalid, pipe_grade_conflict, pipe_connection_angle, pipe_connection_split, pipe_connected_grade or pipe_fixed_connection without partial edits. One undo step.",
  input: {
    nodeId: z.string(),
    action: z.enum(['grade', 'endpoint', 'elevation']),
    detach: z.boolean().optional(),
    gradePercent: z.number().finite().nonnegative().optional(),
    flow: z.enum(['forward', 'reverse']).optional(),
    anchor: z.enum(['start', 'end']).optional(),
    pointIndex: z.number().int().nonnegative().optional(),
    point: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    elevation: measurement('length', 'm').optional(),
  },
  runsIn: 'operation' as const,
}
export const pipeResizeTool = {
  name: 'pipe_resize' as const,
  title: 'Resize connected pipe',
  description:
    "Resize a pipe segment or its same-size, same-material branch, inserting reducers at size boundaries while keeping each leg's grade. scope defaults to segment; branch continues through elbows, couplings and cleanouts, stopping at junctions, reducers and fixed fixture or equipment collars. Caps are resized with the run; the same size is a no-op. Refuses pipe_not_found, node_capability_unavailable, pipe_size_invalid, pipe_ambiguous_connection, pipe_connection_angle, pipe_resize_space or pipe_resize_grade without partial edits. One undo step.",
  input: {
    nodeId: z.string(),
    diameter: measurement('length', 'in', { min: 1.25, max: 8 }),
    scope: z.enum(['segment', 'branch']).optional(),
  },
  runsIn: 'operation' as const,
}
export const pipeOffsetTool = {
  name: 'pipe_offset' as const,
  title: 'Offset pipe around obstacle',
  description:
    'Offset a straight, non-vertical pipe run around an obstacle with four bends, keeping both boundary collars fixed and the parallel sections at their grade. from and to are horizontal distances in metres from the start to the first and last bend; offset is the signed vertical displacement in metres. Each connector consumes abs(offset) of horizontal travel. Reports uphill waste connectors as warnings; this is geometric routing, not drainage or obstacle-clearance validation. Refuses pipe_not_found, node_capability_unavailable, pipe_offset_route, pipe_offset_attachments, pipe_offset_space, pipe_offset_angle or pipe_offset_grade without partial edits. One undo step.',
  input: {
    nodeId: z.string(),
    from: measurement('length', 'm'),
    to: measurement('length', 'm'),
    offset: measurement('length', 'm'),
  },
  runsIn: 'operation' as const,
}
export const pipeConnectTool = {
  name: 'pipe_connect' as const,
  title: 'Connect a pipe to a fixed collar',
  description:
    "Draw a new pipe from an open waste or vent collar of a fixture, trap or fitting to a free endpoint, inheriting the collar's size, material and system. portId names the collar on nodeId; end is a numeric [x, y, z] tuple in level-local metres, not a unit-bearing length string. The first section must leave straight along the collar direction; add further bends from the new pipe. diameter defaults to the collar's; a different diameter inserts a reducer without moving the source. Ordinary catalog models without authored ports are unsupported. Refuses pipe_collar_missing, pipe_collar_changed, pipe_collar_system, pipe_collar_occupied, pipe_collar_direction, pipe_collar_space, pipe_endpoint_invalid, pipe_endpoint_occupied or pipe_size_invalid without partial edits. One undo step.",
  input: {
    nodeId: z.string(),
    portId: z.string(),
    end: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    diameter: measurement('length', 'in', { min: 1.25, max: 8 }).optional(),
  },
  runsIn: 'operation' as const,
}
export const builtinAgentTools = {
  pluginId: 'pascal:core',
  apiVersion: 1,
  version: '1.1.1',
  tools: [
    finishKitchenRunTool,
    checkKitchenClearanceTool,
    editDuctTool,
    pipeGradeTool,
    pipeResizeTool,
    pipeOffsetTool,
    pipeConnectTool,
  ],
} satisfies PluginAgentTools
