'use client'

import {
  type BuildingNode,
  type LevelNode,
  type NodeEvent,
  emitter,
  sceneRegistry,
} from '@pascal-app/core'
import { useEffect } from 'react'
import useViewer from '../../store/use-viewer'

export const SelectionManager = () => {
  const selection = useViewer((s) => s.selection)

  useEffect(() => {
    const { buildingId, levelId, zoneId } = selection

    // Determine current selection depth and what can be clicked
    // 0: no building → can click buildings
    // 1: building selected → can click levels
    // 2: level selected → can click/hover zones
    // 3: zone selected → can hover items/walls (no click needed)

    const onBuildingClick = (event: NodeEvent<BuildingNode>) => {
      if (buildingId) return // Already have a building selected
      event.stopPropagation()
      useViewer.getState().setSelection({ buildingId: event.node.id })
    }

    const onBuildingEnter = (event: NodeEvent<BuildingNode>) => {
      if (buildingId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: event.node.id })
    }

    const onBuildingLeave = (event: NodeEvent<BuildingNode>) => {
      if (buildingId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: null })
    }

    const onLevelClick = (event: NodeEvent<LevelNode>) => {
      if (!buildingId || levelId) return // Need building, but no level yet
      event.stopPropagation()
      useViewer.getState().setSelection({ levelId: event.node.id })
    }

    const onLevelEnter = (event: NodeEvent<LevelNode>) => {
      if (!buildingId || levelId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: event.node.id })
    }

    const onLevelLeave = (event: NodeEvent<LevelNode>) => {
      if (!buildingId || levelId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: null })
    }

    const onZoneClick = (event: NodeEvent) => {
      if (!levelId || zoneId) return // Need level, but no zone yet
      event.stopPropagation()
      useViewer.getState().setSelection({ zoneId: event.node.id })
    }

    const onZoneEnter = (event: NodeEvent) => {
      if (!levelId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: event.node.id })
    }

    const onZoneLeave = (event: NodeEvent) => {
      if (!levelId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: null })
    }

    // Hover for items/walls when zone is selected
    const onItemEnter = (event: NodeEvent) => {
      if (!zoneId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: event.node.id })
    }

    const onItemLeave = (event: NodeEvent) => {
      if (!zoneId) return
      event.stopPropagation()
      useViewer.setState({ hoveredId: null })
    }

    // Grid click deselects in reverse order
    const onGridClick = () => {
      const { buildingId, levelId, zoneId, selectedIds } = useViewer.getState().selection

      if (selectedIds.length > 0) {
        useViewer.getState().setSelection({ selectedIds: [] })
      } else if (zoneId) {
        useViewer.getState().setSelection({ zoneId: null })
      } else if (levelId) {
        useViewer.getState().setSelection({ levelId: null })
      } else if (buildingId) {
        useViewer.getState().setSelection({ buildingId: null })
      }
    }

    // Subscribe to events
    emitter.on('building:click', onBuildingClick)
    emitter.on('building:enter', onBuildingEnter)
    emitter.on('building:leave', onBuildingLeave)

    emitter.on('level:click', onLevelClick)
    emitter.on('level:enter', onLevelEnter)
    emitter.on('level:leave', onLevelLeave)

    emitter.on('zone:click', onZoneClick)
    emitter.on('zone:enter', onZoneEnter)
    emitter.on('zone:leave', onZoneLeave)

    emitter.on('item:enter', onItemEnter)
    emitter.on('item:leave', onItemLeave)
    emitter.on('wall:enter', onItemEnter)
    emitter.on('wall:leave', onItemLeave)

    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('building:click', onBuildingClick)
      emitter.off('building:enter', onBuildingEnter)
      emitter.off('building:leave', onBuildingLeave)

      emitter.off('level:click', onLevelClick)
      emitter.off('level:enter', onLevelEnter)
      emitter.off('level:leave', onLevelLeave)

      emitter.off('zone:click', onZoneClick)
      emitter.off('zone:enter', onZoneEnter)
      emitter.off('zone:leave', onZoneLeave)

      emitter.off('item:enter', onItemEnter)
      emitter.off('item:leave', onItemLeave)
      emitter.off('wall:enter', onItemEnter)
      emitter.off('wall:leave', onItemLeave)

      emitter.off('grid:click', onGridClick)
    }
  }, [selection])

  return <OutlinerSync />
}

const OutlinerSync = () => {
  const selection = useViewer((s) => s.selection)
  const hoveredId = useViewer((s) => s.hoveredId)
  const outliner = useViewer((s) => s.outliner)

  useEffect(() => {
    let idsToHighlight: string[] = []

    // Highlight based on the "deepest" selection
    if (selection.selectedIds.length > 0) {
      idsToHighlight = selection.selectedIds
    } else if (selection.zoneId) {
      idsToHighlight = [selection.zoneId]
    } else if (selection.levelId) {
      idsToHighlight = [selection.levelId]
    } else if (selection.buildingId) {
      idsToHighlight = [selection.buildingId]
    }

    // Sync with the imperative outliner arrays
    outliner.selectedObjects.length = 0
    for (const id of idsToHighlight) {
      const obj = sceneRegistry.nodes.get(id)
      if (obj) outliner.selectedObjects.push(obj)
    }

    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      const obj = sceneRegistry.nodes.get(hoveredId)
      if (obj) outliner.hoveredObjects.push(obj)
    }
  }, [selection, hoveredId, outliner])

  return null
}
