'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type ColumnNode,
  emitter,
  getSelectableKinds,
  type ItemNode,
  type LevelNode,
  type NodeEvent,
  pointInPolygon,
  sceneRegistry,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import useViewer from '../../store/use-viewer'

const tempWorldPos = new Vector3()

// Tolerance for edge detection (in meters)
const EDGE_TOLERANCE = 0.5

// Hardcoded kinds the viewer's selection manager knows about. Registry kinds
// (any NodeDefinition with `capabilities.selectable`) are merged in at
// runtime via getSelectableKinds() — Phase 6 collapses this into a single
// registry-driven list.
type SelectableNodeType =
  | 'building'
  | 'level'
  | 'zone'
  | 'wall'
  | 'fence'
  | 'window'
  | 'door'
  | 'column'
  | 'item'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'roof-segment'
  | (string & {})

// Expand polygon outward by a small amount to include items on edges
const expandPolygon = (polygon: [number, number][], tolerance: number): [number, number][] => {
  if (polygon.length < 3) return polygon

  // Calculate centroid
  let cx = 0,
    cz = 0
  for (const [x, z] of polygon) {
    cx += x
    cz += z
  }
  cx /= polygon.length
  cz /= polygon.length

  // Expand each point outward from centroid
  return polygon.map(([x, z]) => {
    const dx = x - cx
    const dz = z - cz
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len === 0) return [x, z] as [number, number]
    const scale = (len + tolerance) / len
    return [cx + dx * scale, cz + dz * scale] as [number, number]
  })
}

// Check if point is in polygon with tolerance for edges
const pointInPolygonWithTolerance = (
  x: number,
  z: number,
  polygon: [number, number][],
): boolean => {
  // First try exact check
  if (pointInPolygon(x, z, polygon)) return true
  // Then try with expanded polygon for edge tolerance
  const expanded = expandPolygon(polygon, EDGE_TOLERANCE)
  return pointInPolygon(x, z, expanded)
}

interface SelectionStrategy {
  types: SelectableNodeType[]
  handleClick: (node: AnyNode, nativeEvent?: MouseEvent) => void
  handleDeselect: () => void
  isValid: (node: AnyNode) => boolean
}

// Check if a node belongs to the selected level (directly or via wall parent)
const isNodeOnLevel = (node: AnyNode, levelId: string): boolean => {
  const nodes = useScene.getState().nodes

  // Direct child of level
  if (node.parentId === levelId) return true

  // Wall-attached nodes (window/door/item): check if parent wall is on the level
  if ((node.type === 'item' || node.type === 'window' || node.type === 'door') && node.parentId) {
    const parentNode = nodes[node.parentId as keyof typeof nodes]
    if (parentNode?.type === 'wall' && parentNode.parentId === levelId) {
      return true
    }
    // Ceiling/slab/roof-attached items: check if parent structure is on the level
    if (
      (parentNode?.type === 'ceiling' ||
        parentNode?.type === 'slab' ||
        parentNode?.type === 'roof') &&
      parentNode.parentId === levelId
    ) {
      return true
    }
  }

  return false
}

// Check if a node is on the selected level and within the selected zone's polygon
const isNodeInZone = (node: AnyNode, levelId: string, zoneId: string): boolean => {
  const nodes = useScene.getState().nodes
  const zone = nodes[zoneId as keyof typeof nodes] as ZoneNode | undefined
  if (!zone?.polygon?.length) return false

  // First check: node must be on the same level (directly or via wall)
  if (!isNodeOnLevel(node, levelId)) return false

  // Use world position from scene registry for accurate polygon check
  const object3D = sceneRegistry.nodes.get(node.id)
  if (object3D) {
    object3D.getWorldPosition(tempWorldPos)
    return pointInPolygonWithTolerance(tempWorldPos.x, tempWorldPos.z, zone.polygon)
  }

  // Fallback to node data if 3D object not available
  if (node.type === 'item') {
    const item = node as ItemNode
    return pointInPolygonWithTolerance(item.position[0], item.position[2], zone.polygon)
  }

  if (node.type === 'column') {
    const column = node as ColumnNode
    return pointInPolygonWithTolerance(column.position[0], column.position[2], zone.polygon)
  }

  if (node.type === 'wall') {
    const wall = node as WallNode
    const startIn = pointInPolygonWithTolerance(wall.start[0], wall.start[1], zone.polygon)
    const endIn = pointInPolygonWithTolerance(wall.end[0], wall.end[1], zone.polygon)
    return startIn || endIn
  }

  if (node.type === 'fence') {
    const fence = node as { start: [number, number]; end: [number, number] }
    const startIn = pointInPolygonWithTolerance(fence.start[0], fence.start[1], zone.polygon)
    const endIn = pointInPolygonWithTolerance(fence.end[0], fence.end[1], zone.polygon)
    return startIn || endIn
  }

  if (node.type === 'slab' || node.type === 'ceiling') {
    const poly = (node as { polygon: [number, number][] }).polygon
    if (!poly?.length) return false
    // Check if any point of the node's polygon is in the zone (with tolerance)
    for (const [px, pz] of poly) {
      if (pointInPolygonWithTolerance(px, pz, zone.polygon)) return true
    }
    // Check if any point of the zone is in the node's polygon
    for (const [zx, zz] of zone.polygon) {
      if (pointInPolygon(zx, zz, poly)) return true
    }
    return false
  }

  if (node.type === 'roof' || node.type === 'roof-segment') {
    // Roofs on the same level are valid when zone is selected
    return true
  }

  return false
}

const getStrategy = (): SelectionStrategy | null => {
  const { buildingId, levelId, zoneId } = useViewer.getState().selection

  const computeNextIds = (node: AnyNode, selectedIds: string[], event?: any): string[] => {
    const isMeta = event?.metaKey || event?.nativeEvent?.metaKey
    const isCtrl = event?.ctrlKey || event?.nativeEvent?.ctrlKey
    // Shift toggles like Cmd/Ctrl — same convention as the 2D floorplan layer.
    const isShift = event?.shiftKey || event?.nativeEvent?.shiftKey

    if (isMeta || isCtrl || isShift) {
      if (selectedIds.includes(node.id)) {
        return selectedIds.filter((id) => id !== node.id)
      }
      return [...selectedIds, node.id]
    }

    return [node.id]
  }

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

  // Level selected, no zone -> can select zones (only zones on the selected level)
  if (!zoneId) {
    return {
      types: ['zone'],
      handleClick: (node) => {
        useViewer.getState().setSelection({ zoneId: (node as ZoneNode).id })
      },
      handleDeselect: () => {
        useViewer.getState().setSelection({ levelId: null })
      },
      isValid: (node) => node.type === 'zone' && node.parentId === levelId,
    }
  }

  // Zone selected -> can select/hover contents (walls, items, columns, slabs, ceilings, roofs, windows, doors)
  return {
    types: [
      'wall',
      'fence',
      'item',
      'column',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'window',
      'door',
    ],
    handleClick: (node, nativeEvent) => {
      let nodeToSelect = node
      if (node.type === 'roof-segment' && node.parentId) {
        const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
        if (parentNode && parentNode.type === 'roof') {
          nodeToSelect = parentNode
        }
      }

      const { selectedIds } = useViewer.getState().selection
      useViewer
        .getState()
        .setSelection({ selectedIds: computeNextIds(nodeToSelect, selectedIds, nativeEvent) })
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
      const validTypes = [
        'wall',
        'fence',
        'item',
        'column',
        'slab',
        'ceiling',
        'roof',
        'roof-segment',
        'window',
        'door',
      ]
      if (!validTypes.includes(node.type)) return false
      return isNodeInZone(node, levelId, zoneId)
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
      // Ceilings are selected via their floor-plan helper and the
      // boundary-editor vertex handles, never via a direct 3D click on
      // the polygon. Skipping selection routing here means a click on a
      // ceiling falls through to the item / wall / floor below it.
      if (event.node.type === 'ceiling') return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        if (event.node.type === 'slab') {
          useViewer.setState({ hoveredId: null })
          return
        }
        useViewer.setState({ hoveredId: event.node.id })
      }
    }

    const onLeave = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (event.node.type === 'ceiling') return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        useViewer.setState({ hoveredId: null })
      }
    }

    const onClick = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (event.node.type === 'ceiling') return
      if (!strategy.isValid(event.node)) return

      event.stopPropagation()
      clickHandledRef.current = true
      strategy.handleClick(event.node, event.nativeEvent as unknown as MouseEvent)
      // Clear hover immediately after clicking on building/level/zone
      useViewer.setState({ hoveredId: null })
    }

    // Subscribe to all node types. Hardcoded kinds + registry-supplied kinds
    // (any NodeDefinition declaring `capabilities.selectable`). Phase 6
    // collapses these into a single registry-driven list.
    const allTypes: SelectableNodeType[] = [
      'building',
      'level',
      'zone',
      'wall',
      'fence',
      'item',
      'column',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'window',
      'door',
    ]
    const registryKinds = getSelectableKinds().filter(
      (k) => !(allTypes as readonly string[]).includes(k),
    ) as SelectableNodeType[]
    const subscribedKinds = [...allTypes, ...registryKinds]

    for (const type of subscribedKinds) {
      emitter.on(`${type}:enter` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
      emitter.on(`${type}:click` as any, onClick as any)
    }

    return () => {
      for (const type of subscribedKinds) {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:click` as any, onClick as any)
      }
    }
  }, [])

  return (
    <>
      <PointerMissedHandler clickHandledRef={clickHandledRef} />
      <OutlinerSync />
    </>
  )
}

const PointerMissedHandler = ({
  clickHandledRef,
}: {
  clickHandledRef: React.MutableRefObject<boolean>
}) => {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // Only handle left clicks
      const viewerState = useViewer.getState()
      if (viewerState.cameraDragging || viewerState.inputDragging) return
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
  const nodes = useScene((s) => s.nodes)

  useEffect(() => {
    // Sync selected objects
    outliner.selectedObjects.length = 0
    for (const id of selection.selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (node?.type === 'slab') continue
      const obj = sceneRegistry.nodes.get(id)
      if (obj) outliner.selectedObjects.push(obj)
    }

    // Sync hovered objects
    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      const hoveredNode = nodes[hoveredId as AnyNodeId]
      if (hoveredNode?.type === 'slab') return
      const obj = sceneRegistry.nodes.get(hoveredId)
      if (obj) outliner.hoveredObjects.push(obj)
    }
  }, [selection, hoveredId, outliner, nodes])

  return null
}
