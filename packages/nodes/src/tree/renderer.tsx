'use client'

import { sceneRegistry, type TreeNode } from '@pascal-app/core'
import { ParametricNodeRenderer } from '@pascal-app/viewer'
import { useLayoutEffect } from 'react'
import { disposeTreeResources } from './geometry'

/** Keep ordinary parametric placement/events and release shared resources on unmount. */
export default function TreeRenderer({ node }: { node: TreeNode }) {
  useLayoutEffect(() => {
    const root = sceneRegistry.nodes.get(node.id)
    return () => {
      if (root) disposeTreeResources(root)
    }
  }, [node.id])
  return <ParametricNodeRenderer node={node} />
}
