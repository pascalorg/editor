import useEditor from '@/store/use-editor'
import { Vector3 } from 'three'
import { useDraftNode } from './use-draft-node'
import { usePlacementCoordinator } from './use-placement-coordinator'
import type { PlacementState } from './placement-types'

function getInitialState(node: { asset: { attachTo?: string }; parentId: string | null }): PlacementState {
  const attachTo = node.asset.attachTo
  if (attachTo === 'wall' || attachTo === 'wall-side') {
    return { surface: 'wall', wallId: node.parentId, ceilingId: null }
  }
  if (attachTo === 'ceiling') {
    return { surface: 'ceiling', wallId: null, ceilingId: node.parentId }
  }
  return { surface: 'floor', wallId: null, ceilingId: null }
}

export const MoveTool: React.FC = () => {
  const movingNode = useEditor((state) => state.movingNode)
  const draftNode = useDraftNode()

  const exitMoveMode = () => {
    useEditor.getState().setMovingNode(null)
  }

  const cursor = usePlacementCoordinator({
    asset: movingNode!.asset,
    draftNode,
    initialState: movingNode ? getInitialState(movingNode) : undefined,
    initDraft: (gridPosition) => {
      if (!movingNode) return
      draftNode.adopt(movingNode)
      gridPosition.copy(new Vector3(...movingNode.position))
    },
    onCommitted: () => {
      exitMoveMode()
      return false
    },
    onCancel: () => {
      draftNode.destroy()
      exitMoveMode()
    },
  })

  if (!movingNode) return null
  return <>{cursor}</>
}
