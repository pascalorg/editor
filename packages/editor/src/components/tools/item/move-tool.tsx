import type { AnyNodeId, ElevatorNode, SpawnNode } from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'
import { Suspense } from 'react'
import { useMovingNode } from '../../../store/use-interaction-scope'
import { MoveElevatorTool } from '../elevator/move-elevator-tool'
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
 *   3. `elevator` is the lone remaining legacy arm — its bespoke cab/shaft
 *      mover hasn't been ported to a kind-owned affordance yet.
 */
export const MoveTool: React.FC<{
  onNodeMoved?: (nodeId: AnyNodeId) => void
  onSpawnMoved?: (nodeId: SpawnNode['id']) => void
}> = ({ onNodeMoved }) => {
  const movingNode = useMovingNode()

  if (!movingNode) return null

  const def = nodeRegistry.get(movingNode.type)

  const RegistryMove = getRegistryAffordanceTool(movingNode.type, 'move')
  if (RegistryMove) {
    return (
      <Suspense fallback={null}>
        <RegistryMove node={movingNode} />
      </Suspense>
    )
  }

  if (def?.capabilities?.movable) {
    return <MoveRegistryNodeTool node={movingNode} />
  }

  if (movingNode.type === 'elevator')
    return <MoveElevatorTool node={movingNode as ElevatorNode} onCommitted={onNodeMoved} />
  return null
}
