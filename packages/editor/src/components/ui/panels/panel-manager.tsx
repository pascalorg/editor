'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor from '../../../store/use-editor'
import { CeilingPanel } from './ceiling-panel'
import { DoorPanel } from './door-panel'
import { ItemPanel } from './item-panel'
import { ReferencePanel } from './reference-panel'
import { RoofPanel } from './roof-panel'
import { SlabPanel } from './slab-panel'
import { WallPanel } from './wall-panel'
import { WindowPanel } from './window-panel'

export function PanelManager() {
  const selection = useViewer((s) => s.selection)
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const selectedMeasurementGuideId = useEditor((s) => s.selectedMeasurementGuideId)
  const setSelectedMeasurementGuideId = useEditor((s) => s.setSelectedMeasurementGuideId)
  const measurementGuides = useEditor((s) => s.measurementGuides)
  const nodes = useScene((s) => s.nodes)

  useEffect(() => {
    const selectedMeasurementGuide = measurementGuides.find(
      (guide) => guide.id === selectedMeasurementGuideId,
    )

    if (
      selectedMeasurementGuideId &&
      (selection.selectedIds.length > 0 ||
        selection.zoneId ||
        selectedReferenceId ||
        !selectedMeasurementGuide ||
        selectedMeasurementGuide.levelId !== selection.levelId)
    ) {
      setSelectedMeasurementGuideId(null)
    }
  }, [
    measurementGuides,
    selectedMeasurementGuideId,
    selectedReferenceId,
    selection,
    setSelectedMeasurementGuideId,
  ])

  // Show reference panel if a reference is selected
  if (selectedReferenceId) {
    return <ReferencePanel />
  }

  const selectedNodes = selection.selectedIds
    .map((selectedId) => nodes[selectedId as AnyNodeId])
    .filter(Boolean)

  if (selectedNodes.length !== selection.selectedIds.length) {
    return null
  }

  const selectedTypes = new Set(selectedNodes.map((node) => node.type))

  if (selectedTypes.size === 1 && selectedNodes[0]?.type === 'wall') {
    return <WallPanel />
  }

  // Show appropriate panel based on selected node type
  if (selection.selectedIds.length === 1) {
    const node = selectedNodes[0]
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
        case 'door':
          return <DoorPanel />
        case 'window':
          return <WindowPanel />
      }
    }
  }

  return null
}
