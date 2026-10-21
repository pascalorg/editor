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
    'Resize a duct segment or its same-profile branch through elbows, couplings, dampers and caps. Stops at junctions, profile changes and equipment; inserts transitions at fixed boundary collars. Center alignment supports connected runs; face alignment supports free straight runs. Offset adds four elbows to a straight horizontal run while preserving endpoints. from and to are bend positions measured in metres from the start; offset is signed vertical displacement in metres. Does not detect obstacles: check clearance. Refuses insufficient fitting space without partial edits. One undo step.',
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
    'Set grade (percent fall over horizontal travel), flow direction, or an anchored elevation above the level. point is a numeric [x, y, z] tuple in level-local metres, not a unit-bearing length string. Endpoint edits preserve each existing leg grade; vertical elevation edits translate the run. Vertical legs retain their rise. Refuses edits that would regrade connected pipes or move fixed equipment. One undo step.',
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
    'Resize a segment or same-size, same-material branch through elbows, couplings and cleanouts. Stops at junctions, reducers and fixed fixture/equipment collars. Resizes caps and inserts reducers at size boundaries while preserving each leg grade. Refuses ambiguous collars or insufficient straight length without partial edits. One undo step.',
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
    'Add four bends to a straight non-vertical pipe, keeping both boundary collars fixed and preserving grade on the parallel sections. from and to are horizontal distances in metres from the start to the first and last bend; offset is signed vertical displacement in metres. Connectors each consume abs(offset) horizontal travel. Refuses insufficient fitting space without partial edits. Reports uphill waste connectors; this is geometric routing, not drainage or obstacle-clearance validation. One undo step.',
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
    'Draw from an open registered waste/vent fixture, trap or fitting collar to a free endpoint. end is a numeric [x, y, z] tuple in level-local metres, not a unit-bearing length string. Inherits diameter, material and system. The first section must follow the collar direction; add subsequent bends from the new pipe. A different diameter inserts a reducer without moving the source. Refuses occupied collars, incompatible directions and insufficient reducer space. One undo step. Ordinary catalog models without authored ports are unsupported.',
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
