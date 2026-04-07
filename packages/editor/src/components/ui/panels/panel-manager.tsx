'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import { CeilingPanel } from './ceiling-panel'
import { DoorPanel } from './door-panel'
import { ItemPanel } from './item-panel'
import { ReferencePanel } from './reference-panel'
import { RoofPanel } from './roof-panel'
import { RoofSegmentPanel } from './roof-segment-panel'
import { SlabPanel } from './slab-panel'
import { StairPanel } from './stair-panel'
import { StairSegmentPanel } from './stair-segment-panel'
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
        case 'roof-segment':
          return <RoofSegmentPanel />
        case 'stair':
          return <StairPanel />
        case 'stair-segment':
          return <StairSegmentPanel />
        case 'slab':
          return <SlabPanel />
        case 'ceiling':
          return <CeilingPanel />
        case 'wall':
          return <WallPanel />
        case 'door':
          return <DoorPanel />
        case 'window':
          return <WindowPanel />
      }
    }
  }

  return null
}
