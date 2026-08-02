'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { resolveFenceLiftElevation } from './lift'
import type { FenceNode } from './schema'

/**
 * Hosted-railing dependency tracker. A fence with `supportSlabId` renders at
 * its host slab's elevation, but a store update only dirties the node that
 * changed — editing the slab's elevation (or restoring a deleted host) would
 * leave the railing floating at the stale height. Watch each hosted fence's
 * resolved lift and dirty the fence when it moves; `GeometrySystem` rebuilds
 * through `def.geometry` as usual. (Deleting the host needs no help here:
 * `deleteNodesAction` strips `supportSlabId` and dirties the fence itself.)
 */

function fenceLiftSignatures(nodes: Record<string, AnyNode>): Map<string, number> {
  const signatures = new Map<string, number>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'fence') continue
    const fence = node as FenceNode
    if (!fence.supportSlabId) continue
    signatures.set(
      fence.id,
      resolveFenceLiftElevation(fence, (id) => nodes[id]),
    )
  }
  return signatures
}

const FenceSystems = () => {
  useEffect(() => {
    let previous = fenceLiftSignatures(useScene.getState().nodes)

    return useScene.subscribe((state) => {
      const current = fenceLiftSignatures(state.nodes)
      for (const [fenceId, lift] of current.entries()) {
        if (previous.get(fenceId) !== lift) {
          state.markDirty(fenceId as AnyNodeId)
        }
      }
      previous = current
    })
  }, [])

  return null
}

export default FenceSystems
