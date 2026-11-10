import type { NodeEditContribution } from '../definition-contributions'
import { buildingParametrics } from './parametrics'
import type { BuildingNode } from './schema'

export const buildingEditContribution: NodeEditContribution<typeof BuildingNode> = {
  // Building-wide drag (whole-building translate + R/T rotation). Routed
  // through `MoveTool`'s registry-affordance lookup rather than a
  // hardcoded dispatcher arm.
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  parametrics: buildingParametrics,
}
