import type { AnyNodeId, SpawnNode } from '@pascal-app/core'
import { createSceneApi, nodeRegistry, useScene } from '@pascal-app/core'
import { Suspense, useMemo } from 'react'
import { useMovingNode } from '../../../store/use-interaction-scope'
import { MoveRegistryNodeTool } from '../registry/move-registry-node-tool'
import { getRegistryAffordanceTool } from '../shared/affordance-dispatch'

/**
 * MoveTool dispatcher. Routes to (in order):
 *
 *   1. `def.affordanceTools.move` — kind-owned move component, lazy-loaded
 *      via `getRegistryAffordanceTool`. Covers generic movers
 *      (slab / ceiling / wall / fence / column / item / door / window), the
 *      bespoke roof / roof-segment / stair / stair-segment / building
 *      movers, and the polyline / fitting ghost-placement movers
 *      (duct-segment / duct-fitting). A kind that ships its own mover wins
 *      even if it also declares `capabilities.movable` (duct-fitting keeps
 *      `movable` for the inspector / hint readers but places via its ghost).
 *   2. `MoveRegistryNodeTool` — generic translate-on-XZ for kinds that only
 *      declare `capabilities.movable` (shelf, spawn, duct-terminal,
 *      hvac-equipment, …).
 */
export const MoveTool: React.FC<{
  onNodeMoved?: (nodeId: AnyNodeId) => void
  onSpawnMoved?: (nodeId: SpawnNode['id']) => void
}> = ({ onNodeMoved }) => {
  const movingNode = useMovingNode()
  const sceneApi = useMemo(() => createSceneApi(useScene), [])

  if (!movingNode) return null

  const def = nodeRegistry.get(movingNode.type)

  const RegistryMove = getRegistryAffordanceTool(movingNode.type, 'move')
  if (RegistryMove) {
    return (
      <Suspense fallback={null}>
        <RegistryMove node={movingNode} sceneApi={sceneApi} />
      </Suspense>
    )
  }

  if (def?.capabilities?.movable) {
    return <MoveRegistryNodeTool node={movingNode} />
  }

  return null
}
