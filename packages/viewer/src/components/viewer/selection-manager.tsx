'use client'

import {
  type AnyNode,
  type BuildingNode,
  type ItemNode,
  type LevelNode,
  type NodeEvent,
  type WallNode,
  type ZoneNode,
  emitter,
  pointInPolygon,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import useViewer from '../../store/use-viewer'

type SelectableNodeType = 'building' | 'level' | 'zone' | 'wall' | 'item' | 'slab' | 'ceiling' | 'roof'

interface SelectionStrategy {
  types: SelectableNodeType[]
  handleClick: (node: AnyNode) => void
  handleDeselect: () => void
  isValid: (node: AnyNode) => boolean
}

// Check if a node is within the selected zone's polygon
const isNodeInZone = (node: AnyNode, zoneId: string): boolean => {
  const nodes = useScene.getState().nodes
  const zone = nodes[zoneId] as ZoneNode | undefined
  if (!zone?.polygon?.length) return false

  if (node.type === 'item') {
    const item = node as ItemNode
    return pointInPolygon(item.position[0], item.position[2], zone.polygon)
  }

  if (node.type === 'wall') {
    const wall = node as WallNode
    const startIn = pointInPolygon(wall.start[0], wall.start[1], zone.polygon)
    const endIn = pointInPolygon(wall.end[0], wall.end[1], zone.polygon)
    return startIn || endIn
  }

  if (node.type === 'slab' || node.type === 'ceiling') {
    const poly = (node as { polygon: [number, number][] }).polygon
    if (!poly?.length) return false
    // Check if any point of the node's polygon is in the zone
    for (const [px, pz] of poly) {
      if (pointInPolygon(px, pz, zone.polygon)) return true
    }
    // Check if any point of the zone is in the node's polygon
    for (const [zx, zz] of zone.polygon) {
      if (pointInPolygon(zx, zz, poly)) return true
    }
    return false
  }

  if (node.type === 'roof') {
    // Roofs may not have a polygon, check by parent level
    return true // Allow all roofs when zone is selected
  }

  return false
}

const getStrategy = (): SelectionStrategy | null => {
  const { buildingId, levelId, zoneId } = useViewer.getState().selection

  // No building selected -> can select buildings
  if (!buildingId) {
    return {
      types: ['building'],
      handleClick: (node) => {
        useViewer.getState().setSelection({ buildingId: (node as BuildingNode).id })
      },
      handleDeselect: () => {
        // Nothing to deselect at root level
      },
      isValid: (node) => node.type === 'building',
    }
  }

  // Building selected, no level -> can select levels
  if (!levelId) {
    return {
      types: ['level'],
      handleClick: (node) => {
        useViewer.getState().setSelection({ levelId: (node as LevelNode).id })
      },
      handleDeselect: () => {
        useViewer.getState().setSelection({ buildingId: null })
      },
      isValid: (node) => node.type === 'level',
    }
  }

  // Level selected, no zone -> can select zones
  if (!zoneId) {
    return {
      types: ['zone'],
      handleClick: (node) => {
        useViewer.getState().setSelection({ zoneId: (node as ZoneNode).id })
      },
      handleDeselect: () => {
        useViewer.getState().setSelection({ levelId: null })
      },
      isValid: (node) => node.type === 'zone',
    }
  }

  // Zone selected -> can select/hover contents (walls, items, slabs, ceilings, roofs)
  return {
    types: ['wall', 'item', 'slab', 'ceiling', 'roof'],
    handleClick: (node) => {
      const { selectedIds } = useViewer.getState().selection
      // Toggle selection - if already selected, deselect; otherwise select
      if (selectedIds.includes(node.id)) {
        useViewer.getState().setSelection({ selectedIds: selectedIds.filter((id) => id !== node.id) })
      } else {
        useViewer.getState().setSelection({ selectedIds: [node.id] })
      }
    },
    handleDeselect: () => {
      const { selectedIds } = useViewer.getState().selection
      // If items are selected, deselect them first; otherwise go back to level
      if (selectedIds.length > 0) {
        useViewer.getState().setSelection({ selectedIds: [] })
      } else {
        useViewer.getState().setSelection({ zoneId: null })
      }
    },
    isValid: (node) => {
      const validTypes = ['wall', 'item', 'slab', 'ceiling', 'roof']
      if (!validTypes.includes(node.type)) return false
      return isNodeInZone(node, zoneId)
    },
  }
}

export const SelectionManager = () => {
  const selection = useViewer((s) => s.selection)
  const clickHandledRef = useRef(false)

  useEffect(() => {
    const onEnter = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        useViewer.setState({ hoveredId: event.node.id })
      }
    }

    const onLeave = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        useViewer.setState({ hoveredId: null })
      }
    }

    const onClick = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (!strategy.isValid(event.node)) return

      event.stopPropagation()
      clickHandledRef.current = true
      strategy.handleClick(event.node)
    }

    // Subscribe to all node types
    const allTypes: SelectableNodeType[] = ['building', 'level', 'zone', 'wall', 'item', 'slab', 'ceiling', 'roof']
    for (const type of allTypes) {
      emitter.on(`${type}:enter`, onEnter)
      emitter.on(`${type}:leave`, onLeave)
      emitter.on(`${type}:click`, onClick)
    }

    return () => {
      for (const type of allTypes) {
        emitter.off(`${type}:enter`, onEnter)
        emitter.off(`${type}:leave`, onLeave)
        emitter.off(`${type}:click`, onClick)
      }
    }
  }, [selection])

  return (
    <>
      <PointerMissedHandler clickHandledRef={clickHandledRef} />
      <OutlinerSync />
    </>
  )
}

const PointerMissedHandler = ({ clickHandledRef }: { clickHandledRef: React.MutableRefObject<boolean> }) => {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // Only handle left clicks
      if (event.button !== 0) return

      // Use requestAnimationFrame to check after R3F event handlers
      requestAnimationFrame(() => {
        if (clickHandledRef.current) {
          clickHandledRef.current = false
          return
        }

        // Click was not handled by any 3D object -> deselect
        const strategy = getStrategy()
        if (strategy) {
          strategy.handleDeselect()
          useViewer.setState({ hoveredId: null })
        }
      })
    }

    const canvas = gl.domElement
    canvas.addEventListener('click', handleClick)

    return () => {
      canvas.removeEventListener('click', handleClick)
    }
  }, [gl, clickHandledRef])

  return null
}

const OutlinerSync = () => {
  const selection = useViewer((s) => s.selection)
  const hoveredId = useViewer((s) => s.hoveredId)
  const outliner = useViewer((s) => s.outliner)

  useEffect(() => {
    // Sync selected objects
    outliner.selectedObjects.length = 0
    for (const id of selection.selectedIds) {
      const obj = sceneRegistry.nodes.get(id)
      if (obj) outliner.selectedObjects.push(obj)
    }

    // Sync hovered objects
    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      const obj = sceneRegistry.nodes.get(hoveredId)
      if (obj) outliner.hoveredObjects.push(obj)
    }
  }, [selection, hoveredId, outliner])

  return null
}
