import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { useDraftNode } from './use-draft-node'
import { usePlacementCoordinator } from './use-placement-coordinator'

export const ItemTool: React.FC = () => {
  const selectedItem = useEditor((state) => state.selectedItem)
  const draftNode = useDraftNode()

  const cursor = usePlacementCoordinator({
    asset: selectedItem!,
    draftNode,
    initDraft: (gridPosition) => {
      if (!selectedItem?.attachTo) {
        draftNode.create(gridPosition, selectedItem!)
      }
    },
    onCommitted: () => {
      sfxEmitter.emit('sfx:item-place')
      return true
    },
  })

  if (!selectedItem) return null
  return <>{cursor}</>
}
