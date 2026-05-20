import type {
  AnyNodeId,
  BuildingNode,
  ElevatorNode,
  RoofNode,
  RoofSegmentNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'
import { Suspense } from 'react'
import useEditor from '../../../store/use-editor'
import { MoveBuildingContent } from '../building/move-building-tool'
import { MoveElevatorTool } from '../elevator/move-elevator-tool'
import { MoveRegistryNodeTool } from '../registry/move-registry-node-tool'
import { MoveRoofTool } from '../roof/move-roof-tool'
<<<<<<< HEAD
import { MoveSlabTool } from '../slab/move-slab-tool'
import { MoveSpawnTool } from '../spawn/move-spawn-tool'
import { MoveWallTool } from '../wall/move-wall-tool'
import { MoveWindowTool } from '../window/move-window-tool'
import type { PlacementState } from './placement-types'
import { useDraftNode } from './use-draft-node'
import { usePlacementCoordinator } from './use-placement-coordinator'

function getInitialState(node: {
  asset: { attachTo?: string }
  parentId: string | null
}): PlacementState {
  const attachTo = node.asset.attachTo
  if (attachTo === 'wall' || attachTo === 'wall-side') {
    return { surface: 'wall', wallId: node.parentId, ceilingId: null, surfaceItemId: null, roofId: null }
  }
  if (attachTo === 'ceiling') {
    return { surface: 'ceiling', wallId: null, ceilingId: node.parentId, surfaceItemId: null, roofId: null }
  }
  return { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null, roofId: null }
}

function MoveItemContent({ movingNode }: { movingNode: ItemNode }) {
  const draftNode = useDraftNode()

  const meta =
    typeof movingNode.metadata === 'object' && movingNode.metadata !== null
      ? (movingNode.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew

  const cursor = usePlacementCoordinator({
    asset: movingNode.asset,
    draftNode,
    // Duplicates start fresh in floor mode; wall/ceiling draft is created lazily by ensureDraft
    initialState: isNew
      ? { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null }
      : getInitialState(movingNode),
    // Preserve the original item's scale so Y-position calculations use the correct height
    defaultScale: isNew ? movingNode.scale : undefined,
    initDraft: (gridPosition) => {
      if (isNew) {
        // Duplicate: use the same create() path as ItemTool so ghost rendering works correctly.
        // Floor items get a draft immediately; wall/ceiling items are created lazily on surface entry.
        gridPosition.copy(new Vector3(...movingNode.position))
        if (!movingNode.asset.attachTo) {
          draftNode.create(gridPosition, movingNode.asset, movingNode.rotation, movingNode.scale)
        }
      } else {
        draftNode.adopt(movingNode)
        gridPosition.copy(new Vector3(...movingNode.position))
      }
    },
    onCommitted: () => {
      sfxEmitter.emit('sfx:item-place')
      useEditor.getState().setMovingNode(null)
      return false
    },
    onCancel: () => {
      draftNode.destroy()
      useEditor.getState().setMovingNode(null)
    },
  })

  return <>{cursor}</>
}
=======
import { getRegistryAffordanceTool } from '../shared/affordance-dispatch'
>>>>>>> 0bcec8e6ba2a86a9fa9efeee83307491b90dbdf5

/**
 * MoveTool dispatcher. Routes to (in order):
 *
 *   1. `MoveRegistryNodeTool` — generic translate-on-XZ for kinds that
 *      declare `capabilities.movable` (shelf, spawn, item-with-floor-attach,
 *      …).
 *   2. `def.affordanceTools.move` — kind-owned move component
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
  if (movingNode.type === 'stair' || movingNode.type === 'stair-segment')
    return <MoveRoofTool node={movingNode as StairNode | StairSegmentNode} />
  return null
}
