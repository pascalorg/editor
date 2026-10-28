import {
  type AnyNodeId,
  getEffectiveNode,
  isRailingWall,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import type { WallGeometryAdapter } from '@pascal-app/viewer'
import { buildRailingWallGeometry } from './railing-wall-geometry'

/** The walls of a railing's level as they stand live: the walls its ends may die into. */
function levelWalls(wall: WallNode): WallNode[] {
  const nodes = useScene.getState().nodes
  const level = wall.parentId ? nodes[wall.parentId as AnyNodeId] : undefined
  if (level?.type !== 'level') return []
  return level.children.flatMap((id) => {
    const node = nodes[id as AnyNodeId]
    return node?.type === 'wall' ? [getEffectiveNode(node)] : []
  })
}

/**
 * `adapter` with railing walls built as their guard (`railing-wall-geometry.ts`) instead of a
 * solid body. A railing is never cut: its doors are the gaps its guard leaves.
 */
export function withRailingWalls(adapter: WallGeometryAdapter): WallGeometryAdapter {
  return {
    prepareChildren(wall, children, context) {
      if (isRailingWall(wall)) return { envelopeChildren: [], renderChildren: [...children] }
      return (
        adapter.prepareChildren?.(wall, children, context) ?? {
          envelopeChildren: [...children],
          renderChildren: [...children],
        }
      )
    },
    buildGeometry(wall, envelope, children) {
      if (isRailingWall(wall)) return buildRailingWallGeometry(wall, children, levelWalls(wall))
      return adapter.buildGeometry?.(wall, envelope, children) ?? envelope
    },
    syncAuxiliaryGeometry(wall, mesh, geometry) {
      if (!isRailingWall(wall)) adapter.syncAuxiliaryGeometry?.(wall, mesh, geometry)
    },
  }
}
