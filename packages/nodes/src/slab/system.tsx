'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type SlabNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useEffect } from 'react'

/**
 * Slab dependency tracker. The renderable slab polygon derives from level
 * context — wall centerlines/thickness (exterior flush offsets) and sibling
 * slab polygons (interior relief insets) — none of which lives on the slab
 * node itself. Store updates only dirty the node that changed, so a wall
 * thickness edit or a neighbour slab add/remove/reshape would leave stale
 * slab meshes. Watch a per-level signature of those inputs and dirty every
 * slab on a level whose signature moved; `GeometrySystem` then rebuilds
 * them through `def.geometry` as usual.
 */

function levelSlabContextSignatures(nodes: Record<string, AnyNode>): Map<string, string> {
  const partsByLevel = new Map<string, string[]>()

  const push = (levelId: string, part: string) => {
    const parts = partsByLevel.get(levelId)
    if (parts) parts.push(part)
    else partsByLevel.set(levelId, [part])
  }

  for (const node of Object.values(nodes)) {
    const levelId = node.parentId
    if (!levelId) continue
    if (node.type === 'wall') {
      const wall = node as WallNode
      push(
        levelId,
        `w|${wall.id}|${wall.start[0]},${wall.start[1]}|${wall.end[0]},${wall.end[1]}|${wall.thickness ?? ''}|${wall.curveOffset ?? ''}`,
      )
    } else if (node.type === 'slab') {
      const slab = node as SlabNode
      push(levelId, `s|${slab.id}|${slab.polygon.map(([x, z]) => `${x},${z}`).join(';')}`)
    }
  }

  const signatures = new Map<string, string>()
  for (const [levelId, parts] of partsByLevel.entries()) {
    signatures.set(levelId, parts.sort().join('||'))
  }
  return signatures
}

const SlabSystems = () => {
  useEffect(() => {
    let previous = levelSlabContextSignatures(useScene.getState().nodes)

    return useScene.subscribe((state) => {
      const current = levelSlabContextSignatures(state.nodes)
      for (const [levelId, signature] of current.entries()) {
        if (previous.get(levelId) === signature) continue
        for (const node of Object.values(state.nodes)) {
          if (node.type === 'slab' && node.parentId === levelId) {
            state.markDirty(node.id as AnyNodeId)
          }
        }
      }
      previous = current
    })
  }, [])

  return null
}

export default SlabSystems
