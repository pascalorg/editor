'use client'

import type { HedgeNode } from '@pascal-app/core'
import { SiteMoveTool } from '../shared/site-move-tool'
import { createHedgeMoveSession } from './floorplan-move'

/** The plan and canvas share the same Site-space path move and single committed write. */
export default function MoveHedgeTool({ node }: { node: HedgeNode }) {
  return <SiteMoveTool createSession={createHedgeMoveSession} node={node} />
}
