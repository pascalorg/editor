import type {
  AnyNodeId,
  BuildingNode,
  ElevatorNode,
  ItemNode,
  RoofNode,
  RoofSegmentNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import { isPlanDragMovableItem, nodeRegistry } from '@pascal-app/core'
import { Suspense } from 'react'
import useEditor from '../../../store/use-editor'
import { MoveBuildingContent } from '../building/move-building-tool'
import { MoveElevatorTool } from '../elevator/move-elevator-tool'
import { MovePlanItemTool } from '../item/move-plan-item-tool'
import { MoveRegistryNodeTool } from '../registry/move-registry-node-tool'
import { MoveRoofTool } from '../roof/move-roof-tool'
import { MovePlanStairTool } from '../shared/move-plan-position-tool'
import { getRegistryAffordanceTool } from '../shared/affordance-dispatch'

/**
 * MoveTool dispatcher. Routes to (in order):
 *
 *   1. `MoveRegistryNodeTool` — generic translate-on-XZ for kinds that
 *      declare `capabilities.movable` (shelf, spawn, item-with-floor-attach,
 *      …).
 *   2. `MovePlanItemTool` — all existing scene items: drag on plan X/Z,
 *      Y via inspector only (no surface reparenting).
 *   3. `def.affordanceTools.move` — kind-owned move (item duplicates /
 *      (slab / ceiling / wall / fence / column / item / door / window).
 *      Lazy-loaded via `getRegistryAffordanceTool`.
 *   3. The narrow set of kinds that still have legacy movers because no
 *      registry equivalent has been written yet (building / elevator /
 *      roof / stair). Each of these has bespoke move semantics that
 *      don't fit the generic mover and are not yet ported to a
 *      kind-owned affordance.
 */
export const MoveTool: React.FC<{
  onNodeMoved?: (nodeId: AnyNodeId) => void
  onSpawnMoved?: (nodeId: SpawnNode['id']) => void
}> = ({ onNodeMoved }) => {
  const movingNode = useEditor((state) => state.movingNode)

  if (!movingNode) return null

  if (movingNode.type === 'item') {
    const item = movingNode as ItemNode
    if (isPlanDragMovableItem(item)) {
      return <MovePlanItemTool node={item} />
    }
  }

  if (movingNode.type === 'stair') {
    return <MovePlanStairTool node={movingNode as StairNode} />
  }

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

  if (movingNode.type === 'building')
    return <MoveBuildingContent node={movingNode as BuildingNode} />
  if (movingNode.type === 'elevator')
    return <MoveElevatorTool node={movingNode as ElevatorNode} onCommitted={onNodeMoved} />
  if (movingNode.type === 'roof' || movingNode.type === 'roof-segment')
    return <MoveRoofTool node={movingNode as RoofNode | RoofSegmentNode} />
  if (movingNode.type === 'stair-segment')
    return <MoveRoofTool node={movingNode as StairSegmentNode} />
  return null
}
