'use client'

import type { TreeNode } from '@pascal-app/core'
import { SiteMoveTool } from '../shared/site-move-tool'
import { clearTreeMovePreview, createTreeMoveSession } from './floorplan-move'
import { ownsTreePlacement } from './placement'

export default function MoveTreeTool({ node }: { node: TreeNode }) {
  return (
    <SiteMoveTool
      clearPreview={clearTreeMovePreview}
      createSession={createTreeMoveSession}
      handlePointerCancel
      node={node}
      ownsEvent={(target) => ownsTreePlacement('3d', target)}
    />
  )
}
