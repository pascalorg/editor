import type { PluginAgentTools } from '@pascal-app/core/agent-tools'
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
export const builtinAgentTools = {
  pluginId: 'pascal:core',
  apiVersion: 1,
  version: '1.0.0',
  tools: [finishKitchenRunTool, checkKitchenClearanceTool],
} satisfies PluginAgentTools
