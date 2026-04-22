'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import useNavigation from '../../../store/use-navigation'
import { CeilingPanel } from './ceiling-panel'
import { DoorPanel } from './door-panel'
import { FencePanel } from './fence-panel'
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
  const navigationEnabled = useNavigation((s) => s.enabled)
  const moveItemsEnabled = useNavigation((s) => s.moveItemsEnabled)
  const robotMode = useNavigation((s) => s.robotMode)
  const suppressItemPanel = navigationEnabled && moveItemsEnabled && robotMode !== null
  // Only subscribe to the *type* of the single-selected node so we don't
  // re-render on unrelated scene mutations.
  const selectedNodeType = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const id = selectedIds[0]
    return id ? (s.nodes[id as AnyNodeId]?.type ?? null) : null
  })

  if (selectedReferenceId) {
    return <ReferencePanel />
  }

  if (selectedNodeType) {
    switch (selectedNodeType) {
      case 'item':
        if (suppressItemPanel) {
          return null
        }
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
      case 'fence':
        return <FencePanel />
      case 'door':
        return <DoorPanel />
      case 'window':
        return <WindowPanel />
    }
  }

  return null
}
