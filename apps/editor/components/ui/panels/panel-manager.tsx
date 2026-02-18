'use client'

import { AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '@/store/use-editor'
import { CeilingPanel } from './ceiling-panel'
import { ItemPanel } from './item-panel'
import { ReferencePanel } from './reference-panel'
import { RoofPanel } from './roof-panel'
import { SlabPanel } from './slab-panel'
import { WallPanel } from './wall-panel'
import { WindowPanel } from './window-panel'

export function PanelManager() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const nodes = useScene((s) => s.nodes)

  // Show reference panel if a reference is selected
  if (selectedReferenceId) {
    return <ReferencePanel />
  }

  // Show appropriate panel based on selected node type
  if (selectedIds.length === 1) {
    const selectedNode = selectedIds[0]
    const node = nodes[selectedNode as AnyNodeId]
    if (node) {
      switch (node.type) {
        case 'item':
          return <ItemPanel />
        case 'roof':
          return <RoofPanel />
        case 'slab':
          return <SlabPanel />
        case 'ceiling':
          return <CeilingPanel />
        case 'wall':
          return <WallPanel />
        case 'window':
          return <WindowPanel />
      }
    }
  }

  return null
}
