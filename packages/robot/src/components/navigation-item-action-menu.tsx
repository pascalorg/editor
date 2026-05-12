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

function clearRobotViewerItemState() {
  const viewerState = useViewer.getState()
  viewerState.setHoveredId(null)
  viewerState.setPreviewSelectedIds([])
  viewerState.setSelection({
    buildingId: viewerState.selection.buildingId,
    levelId: viewerState.selection.levelId,
    selectedIds: [],
    zoneId: null,
  })
  viewerState.outliner.selectedObjects.length = 0
  viewerState.outliner.hoveredObjects.length = 0
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
  const [activeItemId, setActiveItemId] = useState<ItemNode['id'] | null>(null)
  const [menuPosition, setMenuPosition] = useState<[number, number, number] | null>(null)
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null)
  const ignoreGridClearUntilRef = useRef(0)
  const pendingPlacementRef = useRef<PendingPlacement | null>(null)
  const pointerActionHandledRef = useRef(false)
  const activeItem = useScene((state) =>
    activeItemId ? (state.nodes[activeItemId as AnyNodeId] as ItemNode | undefined) : undefined,
  )

  useEffect(() => {
    pendingPlacementRef.current = pendingPlacement
  }, [pendingPlacement])

  useEffect(() => {
    if (robotMode === null) {
      cleanupPlacementPreview(pendingPlacementRef.current)
      pendingPlacementRef.current = null
      setPendingPlacement(null)
      setActiveItemId(null)
      setMenuPosition(null)
      return
    }
    clearRobotViewerItemState()
  }, [robotMode])

  useEffect(() => {
    if (robotMode === null) {
      return
    }

    const handleItemPointerDown = (event: ItemEvent) => {
      if (!isPrimaryPointerEvent(event)) {
        return
      }
      if (!canUseRobotItemTask(event.node as ItemNode)) {
        return
      }
      suppressNavigationClick(500)
    }

    const handleItemClick = (event: ItemEvent) => {
      if (!isPrimaryPointerEvent(event)) {
        return
      }
      const item = event.node as ItemNode
      if (!canUseRobotItemTask(item)) {
        return
      }

      event.stopPropagation()
      suppressNavigationClick(500)
      clearRobotViewerItemState()
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
    }

    emitter.on('item:pointerdown', handleItemPointerDown as never)
    emitter.on('item:click', handleItemClick as never)
    emitter.on('grid:click', clearMenu as never)

    return () => {
      emitter.off('item:pointerdown', handleItemPointerDown as never)
      emitter.off('item:click', handleItemClick as never)
      emitter.off('grid:click', clearMenu as never)
    }
  }, [robotMode, suppressNavigationClick])

  const closeMenu = useCallback(() => {
    setActiveItemId(null)
    setMenuPosition(null)
    clearRobotViewerItemState()
  }, [])

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
      clearRobotViewerItemState()
    },
    [activeItem],
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
