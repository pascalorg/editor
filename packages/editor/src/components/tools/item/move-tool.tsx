import type { AnyNodeId, ElevatorNode, SpawnNode } from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'
import { Suspense } from 'react'
import useEditor from '../../../store/use-editor'
import { MoveElevatorTool } from '../elevator/move-elevator-tool'
import { MoveRegistryNodeTool } from '../registry/move-registry-node-tool'
import { getRegistryAffordanceTool } from '../shared/affordance-dispatch'

/**
 * MoveTool dispatcher. Routes to (in order):
 *
 *   1. `MoveRegistryNodeTool` — generic translate-on-XZ for kinds that
 *      declare `capabilities.movable` (shelf, spawn, item-with-floor-attach,
 *      …).
 *   2. `def.affordanceTools.move` — kind-owned move component, lazy-loaded
 *      via `getRegistryAffordanceTool`. Covers both generic movers
 *      (slab / ceiling / wall / fence / column / item / door / window) and
 *      the bespoke roof / roof-segment / stair / stair-segment / building
 *      movers ported into `@pascal-app/nodes`.
 *   3. `elevator` is the lone remaining legacy arm — its bespoke cab/shaft
 *      mover hasn't been ported to a kind-owned affordance yet.
 */
export const MoveTool: React.FC<{
  onNodeMoved?: (nodeId: AnyNodeId) => void
  onSpawnMoved?: (nodeId: SpawnNode['id']) => void
}> = ({ onNodeMoved }) => {
  const movingNode = useEditor((state) => state.movingNode)

  if (!movingNode) return null

  const def = nodeRegistry.get(movingNode.type)
  if (def?.capabilities?.movable) {
    return <MoveRegistryNodeTool node={movingNode} />
  }

  const RegistryMove = getRegistryAffordanceTool(movingNode.type, 'move')
  if (RegistryMove) {
    return (
      <Suspense fallback={null}>
        <RegistryMove node={movingNode} />
      </Suspense>
    )
  }

  if (movingNode.type === 'elevator')
    return <MoveElevatorTool node={movingNode as ElevatorNode} onCommitted={onNodeMoved} />
  return null
}
