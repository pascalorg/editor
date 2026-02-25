import type { DoorNode, ItemNode, WindowNode } from '@pascal-app/core'
import { Vector3 } from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { MoveDoorTool } from '../door/move-door-tool'
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
    return { surface: 'wall', wallId: node.parentId, ceilingId: null, surfaceItemId: null }
  }
  if (attachTo === 'ceiling') {
    return { surface: 'ceiling', wallId: null, ceilingId: node.parentId, surfaceItemId: null }
  }
  return { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null }
}

function MoveItemContent({ movingNode }: { movingNode: ItemNode }) {
  const draftNode = useDraftNode()

  const meta = (typeof movingNode.metadata === 'object' && movingNode.metadata !== null)
    ? movingNode.metadata as Record<string, unknown>
    : {}
  const isNew = !!meta.isNew

  const cursor = usePlacementCoordinator({
    asset: movingNode.asset,
    draftNode,
    // Duplicates start fresh in floor mode; wall/ceiling draft is created lazily by ensureDraft
    initialState: isNew ? { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null } : getInitialState(movingNode),
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

export const MoveTool: React.FC = () => {
  const movingNode = useEditor((state) => state.movingNode)

  if (!movingNode) return null
  if (movingNode.type === 'door') return <MoveDoorTool node={movingNode as DoorNode} />
  if (movingNode.type === 'window') return <MoveWindowTool node={movingNode as WindowNode} />
  return <MoveItemContent movingNode={movingNode as ItemNode} />
}
