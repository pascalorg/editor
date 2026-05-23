'use client'

import type { AssetInput } from '@pascal-app/core'
import { triggerSFX, useDraftNode, useEditor, usePlacementCoordinator } from '@pascal-app/editor'

/**
 * Registry-driven item placement tool. Mounted by `ToolManager` when
 * `useEditor.tool === 'item'` (the catalog picker is what selects which
 * asset; this tool handles the cursor follow + click-to-commit flow).
 *
 * Wraps the same `usePlacementCoordinator` + `useDraftNode` primitives
 * the move-tool uses. The placement coordinator runs surface strategies
 * (floor / wall / ceiling / item-surface) so the same cursor logic
 * handles wall-mounted artwork, floor furniture, ceiling fans, and
 * nested items on tables.
 *
 * Replaces the legacy `editor/src/components/tools/item/item-tool.tsx`.
 * The `tools` map in `tool-manager.tsx` no longer needs an `item:` entry
 * — `getRegistryTool('item')` finds this through `def.tool`.
 */
function ItemPlacementContent({ selectedItem }: { selectedItem: AssetInput }) {
  const draftNode = useDraftNode()

  const cursor = usePlacementCoordinator({
    asset: selectedItem,
    draftNode,
    initDraft: (gridPosition) => {
      // Only floor items get a draft on mount; wall / ceiling items are
      // created lazily by the placement coordinator when the cursor
      // enters a surface (so the draft doesn't appear at world origin
      // before the first move event).
      if (selectedItem && !selectedItem.attachTo) {
        draftNode.create(gridPosition, selectedItem)
      }
    },
    onCommitted: () => {
      triggerSFX('sfx:item-place')
      // Returning `true` tells the coordinator to immediately spawn the
      // next draft so the user can keep placing copies — matches the
      // "repeat-on-click" UX of the legacy tool.
      return true
    },
  })

  return <>{cursor}</>
}

function ItemTool() {
  const selectedItem = useEditor((state) => state.selectedItem)
  if (!selectedItem) return null
  return <ItemPlacementContent selectedItem={selectedItem} />
}

export default ItemTool
