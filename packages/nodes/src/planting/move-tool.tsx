'use client'

import type { PlantingNode } from '@pascal-app/core'
import { SiteMoveTool } from '../shared/site-move-tool'
import { createPlantingMoveSession } from './floorplan-move'

/** Same Site-space polygon move as the plan, with no scene writes until the drop. */
export default function MovePlantingTool({ node }: { node: PlantingNode }) {
  return <SiteMoveTool createSession={createPlantingMoveSession} node={node} />
}
