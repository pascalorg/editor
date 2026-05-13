import type { AssetInput } from '@pascal-app/core'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { useDraftNode } from './use-draft-node'
import { usePlacementCoordinator } from './use-placement-coordinator'

function ItemPlacementContent({ selectedItem }: { selectedItem: AssetInput }) {
  const draftNode = useDraftNode()

  const cursor = usePlacementCoordinator({
    asset: selectedItem,
    draftNode,
    initDraft: (gridPosition) => {
      if (selectedItem && !selectedItem.attachTo) {
        draftNode.create(gridPosition, selectedItem)
      }
    },
    onCommitted: () => {
      sfxEmitter.emit('sfx:item-place')
      return true
    },
  })

  return <>{cursor}</>
}

export const ItemTool: React.FC = () => {
  const selectedItem = useEditor((state) => state.selectedItem)

  if (!selectedItem) return null
  return <ItemPlacementContent selectedItem={selectedItem} />
}
