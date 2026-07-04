'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  getSceneSelectionConfig,
  getSceneSelectionKinds,
  type LevelNode,
  type NodeEvent,
  pointInPolygon,
  type SceneSelectionConfig,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import useViewer from '../../store/use-viewer'

const tempWorldPos = new Vector3()

// Tolerance for edge detection (in meters)
const EDGE_TOLERANCE = 0.5

// runtime via getSelectableKinds() — Phase 6 collapses this into a single
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
  handleClick: (node: AnyNode, nativeEvent?: MouseEvent) => void
  handleDeselect: () => void
  isValid: (node: AnyNode) => boolean
}

function useSceneSelectionKinds() {
  const [selectionKinds, setSelectionKinds] = useState(() => getSceneSelectionKinds())

  useEffect(() => {
    let previousKey = getSceneSelectionKinds().join('\0')
    const interval = window.setInterval(() => {
      const nextKinds = getSceneSelectionKinds()
      const nextKey = nextKinds.join('\0')
      if (nextKey === previousKey) return
      previousKey = nextKey
      setSelectionKinds(nextKinds)
    }, 250)
    return () => window.clearInterval(interval)
  }, [])

  return selectionKinds
}

function getSceneSelection(node: AnyNode): SceneSelectionConfig | undefined {
  return getSceneSelectionConfig(node.type)
}

function hasSelectionRole(node: AnyNode, role: NonNullable<SceneSelectionConfig['role']>): boolean {
  return getSceneSelection(node)?.role === role
}

function canRouteHover(node: AnyNode): boolean {
  return getSceneSelection(node)?.hover !== false
}

function canRouteClick(node: AnyNode): boolean {
  return getSceneSelection(node)?.click !== false
}

function canOutline(node: AnyNode | undefined): boolean {
  return node ? getSceneSelection(node)?.outline !== false : false
}

// Check if a node belongs to the selected level (directly or via wall parent)
const isNodeOnLevel = (node: AnyNode, levelId: string): boolean => {
  const nodes = useScene.getState().nodes

  // Direct child of level
  if (node.parentId === levelId) return true

  const levelParentKinds = getSceneSelection(node)?.levelParentKinds
  if (levelParentKinds?.length && node.parentId) {
    const parentNode = nodes[node.parentId as keyof typeof nodes]
    if (
      parentNode &&
      levelParentKinds.includes(parentNode.type) &&
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

  const zoneFootprint = getSceneSelection(node)?.zoneFootprint

  if (zoneFootprint === 'position') {
    const position = (node as { position?: [number, number, number] }).position
    return position ? pointInPolygonWithTolerance(position[0], position[2], zone.polygon) : false
  }

  if (zoneFootprint === 'segment') {
    const segment = node as { start?: [number, number]; end?: [number, number] }
    if (!(segment.start && segment.end)) return false
    const startIn = pointInPolygonWithTolerance(segment.start[0], segment.start[1], zone.polygon)
    const endIn = pointInPolygonWithTolerance(segment.end[0], segment.end[1], zone.polygon)
    return startIn || endIn
  }

  if (zoneFootprint === 'polygon') {
    const poly = (node as { polygon?: [number, number][] }).polygon
    if (!poly?.length) return false
    for (const [px, pz] of poly) {
      if (pointInPolygonWithTolerance(px, pz, zone.polygon)) return true
    }
    for (const [zx, zz] of zone.polygon) {
      if (pointInPolygon(zx, zz, poly)) return true
    }
    return false
  }

  if (zoneFootprint === 'always') return true

  return false
}

const getStrategy = (): SelectionStrategy | null => {
  const { buildingId, levelId, zoneId } = useViewer.getState().selection

  const computeNextIds = (node: AnyNode, selectedIds: string[], event?: any): string[] => {
    const isMeta = event?.metaKey || event?.nativeEvent?.metaKey
    const isCtrl = event?.ctrlKey || event?.nativeEvent?.ctrlKey
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
      handleClick: (node) => {
        useViewer.getState().setSelection({ buildingId: (node as BuildingNode).id })
      },
      handleDeselect: () => {
        // Nothing to deselect at root level
      },
      isValid: (node) => hasSelectionRole(node, 'building'),
    }
  }

  // Building selected, no level -> can select levels
  if (!levelId) {
    return {
      handleClick: (node) => {
        useViewer.getState().setSelection({ levelId: (node as LevelNode).id })
      },
      handleDeselect: () => {
        useViewer.getState().setSelection({ buildingId: null })
      },
      isValid: (node) => hasSelectionRole(node, 'level'),
    }
  }

  // Level selected, no zone -> can select zones (only zones on the selected level)
  if (!zoneId) {
    return {
      handleClick: (node) => {
        useViewer.getState().setSelection({ zoneId: (node as ZoneNode).id })
      },
      handleDeselect: () => {
        useViewer.getState().setSelection({ levelId: null })
      },
      isValid: (node) => hasSelectionRole(node, 'zone') && node.parentId === levelId,
    }
  }

  // Zone selected -> can select/hover contents (walls, items, columns, slabs, ceilings, roofs, windows, doors)
  return {
    handleClick: (node, nativeEvent) => {
      let nodeToSelect = node
      const selectParentKind = getSceneSelection(node)?.selectParentKind
      if (selectParentKind && node.parentId) {
        const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
        if (parentNode && parentNode.type === selectParentKind) {
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
      if (!hasSelectionRole(node, 'zone-content')) return false
      return isNodeInZone(node, levelId, zoneId)
    },
  }
}

export const SelectionManager = () => {
  const selection = useViewer((s) => s.selection)
  const clickHandledRef = useRef(false)
  const sceneSelectionKinds = useSceneSelectionKinds()

  useEffect(() => {
    const onEnter = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (!canRouteHover(event.node)) return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        useViewer.setState({ hoveredId: event.node.id })
      }
    }

    const onLeave = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (!canRouteHover(event.node)) return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        useViewer.setState({ hoveredId: null })
      }
    }

    const onClick = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (!canRouteClick(event.node)) return
      if (!strategy.isValid(event.node)) return

      event.stopPropagation()
      clickHandledRef.current = true
      strategy.handleClick(event.node, event.nativeEvent as unknown as MouseEvent)
      // Clear hover immediately after clicking on building/level/zone
      useViewer.setState({ hoveredId: null })
    }

    for (const type of sceneSelectionKinds) {
      emitter.on(`${type}:enter` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
      emitter.on(`${type}:click` as any, onClick as any)
    }

    return () => {
      for (const type of sceneSelectionKinds) {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:click` as any, onClick as any)
      }
    }
  }, [sceneSelectionKinds])

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
      if (!canOutline(node)) continue
      const obj = sceneRegistry.nodes.get(id)
      if (obj) outliner.selectedObjects.push(obj)
    }

    // Sync hovered objects
    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      const hoveredNode = nodes[hoveredId as AnyNodeId]
      if (!canOutline(hoveredNode)) return
      const obj = sceneRegistry.nodes.get(hoveredId)
      if (obj) outliner.hoveredObjects.push(obj)
    }
  }, [selection, hoveredId, outliner, nodes])

  return null
}
