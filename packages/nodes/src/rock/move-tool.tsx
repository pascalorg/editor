'use client'

import type { RockNode } from '@pascal-app/core'
import { SiteMoveTool } from '../shared/site-move-tool'
import { createRockMoveSession } from './floorplan-move'
import { ownsRockPlacement } from './placement'

/** The canvas and plan share the same Site-space move and one committed polygon update. */
export default function MoveRockTool({ node }: { node: RockNode }) {
  return (
    <SiteMoveTool
      createSession={createRockMoveSession}
      handlePointerCancel
      node={node}
      ownsEvent={(target) => ownsRockPlacement('3d', target)}
      requireMoveToCommit={false}
    />
  )
}
