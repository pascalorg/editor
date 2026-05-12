'use client'

import {
  type AnyNodeId,
  emitter,
  generateId,
  getScaledDimensions,
  type GridEvent,
  ItemNode,
  type ItemEvent,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Copy, Move, Trash2, Wrench } from 'lucide-react'
import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Box3, type Camera, type Object3D, Vector3 } from 'three'
import {
  canUseRobotItemTask,
  requestNavigationItemDelete,
  requestNavigationItemRepair,
  default as useNavigation,
  type NavigationItemMoveRequest,
} from '../store/use-navigation'
import navigationVisualsStore from '../store/use-navigation-visuals'
import { stripTransientMetadata } from '../lib/transient'

const BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-foreground'
const ACTION_MENU_HALF_WIDTH_PX = 76
const ACTION_MENU_HALF_HEIGHT_PX = 24
const actionMenuProjectedPosition = new Vector3()

type PendingPlacement = {
  finalPosition: [number, number, number]
  finalRotation: [number, number, number]
  operation: 'copy' | 'move'
  previewItemId: ItemNode['id']
  sourceItemId: ItemNode['id']
}

function getRobotSelectableObject(itemId: ItemNode['id'] | null) {
  if (!itemId) {
    return null
  }

  const node = useScene.getState().nodes[itemId as AnyNodeId]
  if (node?.type !== 'item' || !canUseRobotItemTask(node)) {
    return null
  }

  const object = sceneRegistry.nodes.get(itemId)
  return object?.parent ? object : null
}

function syncRobotViewerObjectList(target: Object3D[], itemId: ItemNode['id'] | null) {
  const object = getRobotSelectableObject(itemId)
  if (target.length === (object ? 1 : 0) && target[0] === object) {
    return
  }

  target.length = 0
  if (object) {
    target.push(object)
  }
}

function syncRobotViewerItemState(
  selectedItemId: ItemNode['id'] | null,
  hoveredItemId: ItemNode['id'] | null,
) {
  const viewerState = useViewer.getState()
  const selectedObject = getRobotSelectableObject(selectedItemId)
  const hoveredObject = getRobotSelectableObject(hoveredItemId)
  const resolvedSelectedItemId = selectedObject ? selectedItemId : null
  const resolvedHoveredItemId = hoveredObject ? hoveredItemId : null

  if (viewerState.hoveredId !== resolvedHoveredItemId) {
    viewerState.setHoveredId(resolvedHoveredItemId)
  }
  if (viewerState.previewSelectedIds.length > 0) {
    viewerState.setPreviewSelectedIds([])
  }
  if (
    viewerState.selection.zoneId !== null ||
    viewerState.selection.selectedIds.length !== (resolvedSelectedItemId ? 1 : 0) ||
    viewerState.selection.selectedIds[0] !== resolvedSelectedItemId
  ) {
    viewerState.setSelection({
      buildingId: viewerState.selection.buildingId,
      levelId: viewerState.selection.levelId,
      selectedIds: resolvedSelectedItemId ? [resolvedSelectedItemId] : [],
      zoneId: null,
    })
  }
  syncRobotViewerObjectList(viewerState.outliner.selectedObjects, resolvedSelectedItemId)
  syncRobotViewerObjectList(viewerState.outliner.hoveredObjects, resolvedHoveredItemId)
}

function clearRobotViewerItemState() {
  syncRobotViewerItemState(null, null)
}

function getPreviewVisualStateForOperation(operation: PendingPlacement['operation']) {
  return operation === 'copy' ? 'copy-source-pending' : 'source-pending'
}

function withPausedHistory(run: () => void) {
  const temporal = useScene.temporal.getState()
  temporal.pause()
  try {
    run()
  } finally {
    temporal.resume()
  }
}

function createPlacementPreviewNode(
  source: ItemNode,
  operation: PendingPlacement['operation'],
): PendingPlacement | null {
  if (!source.parentId) {
    return null
  }

  const previewItemId = generateId(
    operation === 'copy' ? 'item_debug_copy_preview' : 'item_debug_move_preview',
  ) as ItemNode['id']
  const metadata = {
    ...(stripTransientMetadata(source.metadata) as Record<string, unknown>),
    isTransient: true,
  }
  const previewNode = ItemNode.parse({
    asset: source.asset,
    id: previewItemId,
    metadata,
    name: source.name,
    parentId: source.parentId,
    position: [...source.position] as [number, number, number],
    rotation: [...source.rotation] as [number, number, number],
    scale: [...source.scale] as [number, number, number],
    side: source.side,
    visible: true,
  })

  withPausedHistory(() => {
    useScene.getState().createNode(previewNode, source.parentId as AnyNodeId)
  })

  const navigationVisuals = navigationVisualsStore.getState()
  navigationVisuals.registerTaskPreviewNode(previewItemId)
  navigationVisuals.setItemMovePreview({ id: previewItemId, sourceItemId: source.id })
  navigationVisuals.setItemMoveVisualState(previewItemId, 'destination-preview')
  navigationVisuals.setItemMoveVisualState(source.id, getPreviewVisualStateForOperation(operation))

  return {
    finalPosition: [...source.position] as [number, number, number],
    finalRotation: [...source.rotation] as [number, number, number],
    operation,
    previewItemId,
    sourceItemId: source.id,
  }
}

function cleanupPlacementPreview(pending: PendingPlacement | null) {
  if (!pending) {
    return
  }

  const navigationVisuals = navigationVisualsStore.getState()
  navigationVisuals.setItemMoveVisualState(pending.sourceItemId, null)
  navigationVisuals.setItemMoveVisualState(pending.previewItemId, null)
  navigationVisuals.setItemMovePreview(null)
  navigationVisuals.unregisterTaskPreviewNode(pending.previewItemId)
  useLiveTransforms.getState().clear(pending.previewItemId)
  withPausedHistory(() => {
    const previewNode = useScene.getState().nodes[pending.previewItemId as AnyNodeId]
    if (previewNode?.type === 'item') {
      useScene.getState().deleteNode(pending.previewItemId as AnyNodeId)
    }
  })
}

function updatePlacementPreview(pending: PendingPlacement, position: [number, number, number]) {
  useLiveTransforms.getState().set(pending.previewItemId, {
    position,
    rotation: pending.finalRotation[1] ?? 0,
  })
  navigationVisualsStore.getState().setItemMoveVisualState(pending.previewItemId, 'destination-preview')
}

function buildPlacementRequest(
  pending: PendingPlacement,
  source: ItemNode,
): NavigationItemMoveRequest {
  const operation = pending.operation
  return {
    finalUpdate: {
      metadata: stripTransientMetadata(source.metadata) as ItemNode['metadata'],
      parentId: source.parentId,
      position: pending.finalPosition,
      rotation: pending.finalRotation,
      side: source.side,
      visible: true,
    },
    itemDimensions: getScaledDimensions(source),
    itemId: source.id,
    levelId: source.parentId,
    operation,
    sourcePosition: [...source.position] as [number, number, number],
    sourceRotation: [...source.rotation] as [number, number, number],
    targetPreviewItemId: pending.previewItemId,
    visualItemId:
      operation === 'copy'
        ? (`${pending.previewItemId}__copy_carry` as ItemNode['id'])
        : source.id,
  }
}

function isPrimaryPointerEvent(event: ItemEvent) {
  const nativeEvent = event.nativeEvent as unknown as MouseEvent | PointerEvent | undefined
  return typeof nativeEvent?.button !== 'number' || nativeEvent.button === 0
}

function resolveMenuPosition(
  itemId: ItemNode['id'],
  fallbackPosition?: [number, number, number],
): [number, number, number] | null {
  const object = sceneRegistry.nodes.get(itemId)
  if (object) {
    const bounds = new Box3().setFromObject(object)
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new Vector3())
      return [center.x, bounds.max.y + 0.3, center.z]
    }
  }

  if (fallbackPosition) {
    return [fallbackPosition[0], fallbackPosition[1] + 0.5, fallbackPosition[2]]
  }

  return null
}

function calculateActionMenuScreenPosition(
  object: Object3D,
  camera: Camera,
  size: { width: number; height: number },
) {
  actionMenuProjectedPosition.setFromMatrixPosition(object.matrixWorld).project(camera)
  const x = (actionMenuProjectedPosition.x * size.width) / 2 + size.width / 2
  const y = (-actionMenuProjectedPosition.y * size.height) / 2 + size.height / 2

  return [
    Math.min(Math.max(x, ACTION_MENU_HALF_WIDTH_PX), size.width - ACTION_MENU_HALF_WIDTH_PX),
    Math.min(Math.max(y, ACTION_MENU_HALF_HEIGHT_PX), size.height - ACTION_MENU_HALF_HEIGHT_PX),
  ]
}

export function NavigationItemActionMenu() {
  const robotMode = useNavigation((state) => state.robotMode)
  const suppressNavigationClick = useNavigation((state) => state.suppressNavigationClick)
  const invalidate = useThree((state) => state.invalidate)
  const [activeItemId, setActiveItemId] = useState<ItemNode['id'] | null>(null)
  const [menuPosition, setMenuPosition] = useState<[number, number, number] | null>(null)
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null)
  const hoveredRobotItemIdRef = useRef<ItemNode['id'] | null>(null)
  const ignoreGridClearUntilRef = useRef(0)
  const pendingPlacementRef = useRef<PendingPlacement | null>(null)
  const pointerActionHandledRef = useRef(false)
  const selectedRobotItemIdRef = useRef<ItemNode['id'] | null>(null)
  const activeItem = useScene((state) =>
    activeItemId ? (state.nodes[activeItemId as AnyNodeId] as ItemNode | undefined) : undefined,
  )

  const clearRobotSelection = useCallback(() => {
    selectedRobotItemIdRef.current = null
    hoveredRobotItemIdRef.current = null
    clearRobotViewerItemState()
    invalidate()
  }, [invalidate])

  const selectRobotItem = useCallback(
    (item: ItemNode) => {
      selectedRobotItemIdRef.current = item.id
      hoveredRobotItemIdRef.current = null
      syncRobotViewerItemState(item.id, null)
      invalidate()
    },
    [invalidate],
  )

  const setRobotHoverItem = useCallback(
    (itemId: ItemNode['id'] | null) => {
      hoveredRobotItemIdRef.current = itemId
      syncRobotViewerItemState(selectedRobotItemIdRef.current, itemId)
      invalidate()
    },
    [invalidate],
  )

  useEffect(() => {
    pendingPlacementRef.current = pendingPlacement
  }, [pendingPlacement])

  useFrame(() => {
    if (robotMode === null) {
      return
    }
    if (!selectedRobotItemIdRef.current && !hoveredRobotItemIdRef.current) {
      return
    }

    syncRobotViewerItemState(selectedRobotItemIdRef.current, hoveredRobotItemIdRef.current)
  })

  useEffect(() => {
    if (robotMode === null) {
      cleanupPlacementPreview(pendingPlacementRef.current)
      pendingPlacementRef.current = null
      setPendingPlacement(null)
      setActiveItemId(null)
      setMenuPosition(null)
      clearRobotSelection()
      return
    }
    clearRobotSelection()
  }, [clearRobotSelection, robotMode])

  useEffect(() => {
    if (robotMode === null) {
      return
    }

    const handleItemPointerDown = (event: ItemEvent) => {
      if (pendingPlacementRef.current) {
        return
      }
      if (!isPrimaryPointerEvent(event)) {
        return
      }
      if (!canUseRobotItemTask(event.node as ItemNode)) {
        return
      }
      suppressNavigationClick(500)
    }

    const handleItemEnter = (event: ItemEvent) => {
      if (pendingPlacementRef.current) {
        return
      }
      const item = event.node as ItemNode
      if (!canUseRobotItemTask(item)) {
        return
      }

      setRobotHoverItem(item.id)
    }

    const handleItemLeave = (event: ItemEvent) => {
      const item = event.node as ItemNode
      if (!canUseRobotItemTask(item)) {
        return
      }

      if (hoveredRobotItemIdRef.current === item.id) {
        setRobotHoverItem(null)
      }
    }

    const handleItemClick = (event: ItemEvent) => {
      if (pendingPlacementRef.current) {
        return
      }
      if (!isPrimaryPointerEvent(event)) {
        return
      }
      const item = event.node as ItemNode
      if (!canUseRobotItemTask(item)) {
        return
      }

      event.stopPropagation()
      suppressNavigationClick(500)
      selectRobotItem(item)
      if (
        typeof window !== 'undefined' &&
        window.localStorage.getItem('pascal-navigation-debug') === '1'
      ) {
        document.documentElement.dataset.pascalRobotActionMenuNode = item.id
      }
      setActiveItemId(item.id)
      const nextMenuPosition = resolveMenuPosition(item.id, event.position ?? item.position)
      if (
        typeof window !== 'undefined' &&
        window.localStorage.getItem('pascal-navigation-debug') === '1'
      ) {
        document.documentElement.dataset.pascalRobotActionMenuPosition = JSON.stringify(
          nextMenuPosition,
        )
      }
      setMenuPosition(nextMenuPosition)
      ignoreGridClearUntilRef.current = performance.now() + 200
    }

    const clearMenu = () => {
      if (pendingPlacementRef.current) {
        return
      }
      if (performance.now() < ignoreGridClearUntilRef.current) {
        return
      }
      setActiveItemId(null)
      setMenuPosition(null)
      clearRobotSelection()
    }

    emitter.on('item:enter', handleItemEnter as never)
    emitter.on('item:leave', handleItemLeave as never)
    emitter.on('item:pointerdown', handleItemPointerDown as never)
    emitter.on('item:click', handleItemClick as never)
    emitter.on('grid:click', clearMenu as never)

    return () => {
      emitter.off('item:enter', handleItemEnter as never)
      emitter.off('item:leave', handleItemLeave as never)
      emitter.off('item:pointerdown', handleItemPointerDown as never)
      emitter.off('item:click', handleItemClick as never)
      emitter.off('grid:click', clearMenu as never)
    }
  }, [clearRobotSelection, robotMode, selectRobotItem, setRobotHoverItem, suppressNavigationClick])

  const closeMenu = useCallback(() => {
    setActiveItemId(null)
    setMenuPosition(null)
    clearRobotSelection()
  }, [clearRobotSelection])

  useEffect(() => {
    if (!pendingPlacement) {
      return
    }

    const cancelPlacement = () => {
      const pending = pendingPlacementRef.current
      cleanupPlacementPreview(pending)
      pendingPlacementRef.current = null
      setPendingPlacement(null)
    }

    const handleGridMove = (event: GridEvent) => {
      const pending = pendingPlacementRef.current
      if (!pending) {
        return
      }

      const source = useScene.getState().nodes[pending.sourceItemId as AnyNodeId]
      if (source?.type !== 'item') {
        cancelPlacement()
        return
      }

      const finalPosition: [number, number, number] = [
        event.localPosition[0],
        source.position[1],
        event.localPosition[2],
      ]
      const nextPending = {
        ...pending,
        finalPosition,
      }
      pendingPlacementRef.current = nextPending
      updatePlacementPreview(nextPending, finalPosition)
    }

    const handleGridClick = () => {
      const pending = pendingPlacementRef.current
      if (!pending) {
        return
      }

      const source = useScene.getState().nodes[pending.sourceItemId as AnyNodeId]
      if (source?.type !== 'item') {
        cancelPlacement()
        return
      }

      const navigationVisuals = navigationVisualsStore.getState()
      navigationVisuals.setItemMoveVisualState(
        pending.sourceItemId,
        getPreviewVisualStateForOperation(pending.operation),
      )
      navigationVisuals.setItemMoveVisualState(pending.previewItemId, 'destination-ghost')
      navigationVisuals.setItemMovePreview({ id: pending.previewItemId, sourceItemId: source.id })
      useLiveTransforms.getState().clear(pending.previewItemId)
      withPausedHistory(() => {
        useScene.getState().updateNode(pending.previewItemId as AnyNodeId, {
          metadata: {
            ...(stripTransientMetadata(source.metadata) as Record<string, unknown>),
            isTransient: true,
          },
          parentId: source.parentId,
          position: pending.finalPosition,
          rotation: pending.finalRotation,
          visible: true,
        })
      })
      useNavigation.getState().requestItemMove(buildPlacementRequest(pending, source))
      useNavigation.getState().setItemMoveLocked(false)
      pendingPlacementRef.current = null
      setPendingPlacement(null)
      suppressNavigationClick(500)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelPlacement()
      }
    }

    emitter.on('grid:move', handleGridMove as never)
    emitter.on('grid:click', handleGridClick as never)
    emitter.on('grid:context-menu', cancelPlacement as never)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      emitter.off('grid:move', handleGridMove as never)
      emitter.off('grid:click', handleGridClick as never)
      emitter.off('grid:context-menu', cancelPlacement as never)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pendingPlacement, suppressNavigationClick])

  useEffect(
    () => () => {
      cleanupPlacementPreview(pendingPlacementRef.current)
      pendingPlacementRef.current = null
    },
    [],
  )

  const beginPlacement = useCallback(
    (operation: PendingPlacement['operation']) => {
      if (!activeItem) {
        return
      }

      cleanupPlacementPreview(pendingPlacementRef.current)
      const pending = createPlacementPreviewNode(activeItem, operation)
      if (!pending) {
        return
      }

      pendingPlacementRef.current = pending
      setPendingPlacement(pending)
      setActiveItemId(null)
      setMenuPosition(null)
      selectRobotItem(activeItem)
    },
    [activeItem, selectRobotItem],
  )

  const handleMove = useCallback(() => {
    if (!activeItem) {
      return
    }
    beginPlacement('move')
  }, [activeItem, beginPlacement])

  const handleCopy = useCallback(() => {
    if (!activeItem) {
      return
    }
    beginPlacement('copy')
  }, [activeItem, beginPlacement])

  const handleRepair = useCallback(() => {
    if (activeItem) {
      requestNavigationItemRepair(activeItem)
    }
    closeMenu()
  }, [activeItem, closeMenu])

  const handleDelete = useCallback(() => {
    if (activeItem) {
      requestNavigationItemDelete(activeItem)
    }
    closeMenu()
  }, [activeItem, closeMenu])

  const runMenuActionFromPointer = useCallback(
    (event: PointerEvent<HTMLButtonElement>, action: () => void) => {
      event.preventDefault()
      event.stopPropagation()
      pointerActionHandledRef.current = true
      action()
      window.setTimeout(() => {
        pointerActionHandledRef.current = false
      }, 0)
    },
    [],
  )

  const runMenuActionFromClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
      event.stopPropagation()
      if (pointerActionHandledRef.current) {
        event.preventDefault()
        return
      }
      action()
    },
    [],
  )

  if (!(robotMode && activeItem && canUseRobotItemTask(activeItem) && menuPosition)) {
    return null
  }

  return (
    <group position={menuPosition}>
      <Html
        calculatePosition={calculateActionMenuScreenPosition}
        center
        style={{ pointerEvents: 'auto', touchAction: 'none' }}
        zIndexRange={[120, 0]}
      >
        <div
          className="flex items-center gap-1 rounded-full border border-border bg-background/90 p-1 shadow-xl backdrop-blur-md"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Move item with robot"
            className={BUTTON_CLASS}
            onClick={(event) => runMenuActionFromClick(event, handleMove)}
            onPointerDown={(event) => runMenuActionFromPointer(event, handleMove)}
          >
            <Move className="h-4 w-4" />
          </button>
          <button
            aria-label="Copy item with robot"
            className={BUTTON_CLASS}
            onClick={(event) => runMenuActionFromClick(event, handleCopy)}
            onPointerDown={(event) => runMenuActionFromPointer(event, handleCopy)}
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            aria-label="Repair item with robot"
            className={BUTTON_CLASS}
            onClick={(event) => runMenuActionFromClick(event, handleRepair)}
            onPointerDown={(event) => runMenuActionFromPointer(event, handleRepair)}
          >
            <Wrench className="h-4 w-4" />
          </button>
          <button
            aria-label="Delete item with robot"
            className={BUTTON_CLASS}
            onClick={(event) => runMenuActionFromClick(event, handleDelete)}
            onPointerDown={(event) => runMenuActionFromPointer(event, handleDelete)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </Html>
    </group>
  )
}
