import type { ItemNode, WindowNode } from '@pascal-app/core'
import { Vector3 } from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
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

  const cursor = usePlacementCoordinator({
    asset: movingNode.asset,
    draftNode,
    initialState: getInitialState(movingNode),
    initDraft: (gridPosition) => {
      draftNode.adopt(movingNode)
      gridPosition.copy(new Vector3(...movingNode.position))
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
  if (movingNode.type === 'window') return <MoveWindowTool node={movingNode as WindowNode} />
  return <MoveItemContent movingNode={movingNode as ItemNode} />
}
