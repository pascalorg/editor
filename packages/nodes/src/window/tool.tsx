import {
  type AnyNodeId,
  emitter,
  isCurvedWall,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallEvent,
  WindowNode,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  EDITOR_LAYER,
  getSideFromNormal,
  isValidWallSideFace,
  snapToHalf,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, type LineSegments } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import {
  clearOpeningGuides3D,
  publishOpeningGuidesForWallEvent,
  resolveSillSnap,
} from '../shared/opening-guides-runtime'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './window-math'

// Shared edge material — reuse across renders, just toggle color
const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44, // red-500 default (invalid)
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

/**
 * Window tool — places WindowNodes on walls only.
 * Shows a rectangle cursor (green = valid, red = invalid) matching window dimensions.
 */
const WindowTool: React.FC = () => {
  const draftRef = useRef<WindowNode | null>(null)
  const lastPlacementRef = useRef<{
    wallId: string
    clampedX: number
    clampedY: number
    side: 'front' | 'back'
    itemRotation: number
    valid: boolean
  } | null>(null)
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)

  useEffect(() => {
    useScene.temporal.getState().pause()

    const getLevelId = () => useViewer.getState().selection.levelId
    const getLevelYOffset = () => {
      const id = getLevelId()
      return id ? (sceneRegistry.nodes.get(id as AnyNodeId)?.position.y ?? 0) : 0
    }
    const getSlabElevation = (wallEvent: WallEvent) =>
      spatialGridManager.getSlabElevationForWall(
        wallEvent.node.parentId ?? '',
        wallEvent.node.start,
        wallEvent.node.end,
      )

    const markWallDirty = (wallId: string) => {
      useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
    }

    const lastLogAt = new Map<string, number>()
    const log = (message: string, details?: Record<string, unknown>) => {
      console.info(`[pascal:window-tool] ${message}`, details)
    }
    const logSkip = (key: string, message: string, details?: Record<string, unknown>) => {
      const now = performance.now()
      const last = lastLogAt.get(key) ?? 0
      if (now - last < 750) return
      lastLogAt.set(key, now)
      log(message, details)
    }
    const eventDetails = (event: WallEvent) => ({
      wallId: event.node.id,
      wallParentId: event.node.parentId,
      levelId: getLevelId(),
      normal: event.normal,
      localPosition: event.localPosition,
      hasDraft: Boolean(draftRef.current),
      draftId: draftRef.current?.id,
      draftParentId: draftRef.current?.parentId,
      lastPlacement: lastPlacementRef.current,
    })

    log('mounted')

    const destroyDraft = () => {
      if (!draftRef.current) return
      const wallId = draftRef.current.parentId
      log('destroy transient draft', { draftId: draftRef.current.id, wallId })
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
      // Rebuild wall so it removes the cutout from the deleted draft
      if (wallId) markWallDirty(wallId)
    }

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      clearOpeningGuides3D()
    }

    const updateCursor = (
      worldPosition: [number, number, number],
      cursorRotationY: number,
      valid: boolean,
    ) => {
      const group = cursorGroupRef.current
      if (!group) return
      group.visible = true
      group.position.set(...worldPosition)
      group.rotation.y = cursorRotationY
      edgeMaterial.color.setHex(valid ? 0x22_c5_5e : 0xef_44_44)
    }

    const onWallEnter = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) {
        logSkip(
          'enter-invalid-face',
          'wall:enter ignored: invalid wall side face',
          eventDetails(event),
        )
        return
      }
      if (isCurvedWall(event.node)) {
        log('wall:enter ignored: curved walls do not support windows yet', eventDetails(event))
        destroyDraft()
        hideCursor()
        return
      }
      const levelId = getLevelId()
      if (!levelId) {
        logSkip(
          'enter-no-level',
          'wall:enter ignored: no active level selection',
          eventDetails(event),
        )
        return
      }
      // Only interact with walls on the current level
      if (event.node.parentId !== levelId) {
        logSkip(
          'enter-wrong-level',
          'wall:enter ignored: wall is not on active level',
          eventDetails(event),
        )
        return
      }

      destroyDraft()

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])

      const width = 1.5
      const height = 1.5

      const snappedY =
        resolveSillSnap({
          wall: event.node,
          movingId: '__window_preview__',
          localX,
          localY,
          width,
          height,
          nodes: useScene.getState().nodes,
        }) ?? localY
      const { clampedX, clampedY } = clampToWall(event.node, localX, snappedY, width, height)

      const node = WindowNode.parse({
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        metadata: { isTransient: true },
      })

      useScene.getState().createNode(node, event.node.id as AnyNodeId)
      draftRef.current = node

      const valid = !hasWallChildOverlap(event.node.id, clampedX, clampedY, width, height, node.id)
      lastPlacementRef.current = {
        wallId: event.node.id,
        clampedX,
        clampedY,
        side,
        itemRotation,
        valid,
      }
      log('created transient draft from wall:enter', {
        ...eventDetails(event),
        draftId: node.id,
        clampedX,
        clampedY,
        width,
        height,
        side,
        itemRotation,
        valid,
      })

      updateCursor(
        wallLocalToWorld(
          event.node,
          clampedX,
          clampedY,
          getLevelYOffset(),
          getSlabElevation(event),
        ),
        cursorRotation,
        valid,
      )
      publishOpeningGuidesForWallEvent({
        wall: event.node,
        movingId: node.id,
        centerS: clampedX,
        centerY: clampedY,
        width,
        height,
        includeVertical: true,
        levelYOffset: getLevelYOffset(),
        slabElevation: getSlabElevation(event),
      })
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) {
        logSkip(
          'move-invalid-face',
          'wall:move ignored: invalid wall side face',
          eventDetails(event),
        )
        return
      }
      if (isCurvedWall(event.node)) {
        logSkip(
          'move-curved-wall',
          'wall:move ignored: curved walls do not support windows yet',
          eventDetails(event),
        )
        destroyDraft()
        hideCursor()
        return
      }
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) {
        logSkip(
          'move-wrong-level',
          'wall:move ignored: wall is not on active level',
          eventDetails(event),
        )
        return
      }

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])

      const width = draftRef.current?.width ?? 1.5
      const height = draftRef.current?.height ?? 1.5

      const snappedY =
        resolveSillSnap({
          wall: event.node,
          movingId: draftRef.current?.id ?? '__window_preview__',
          localX,
          localY,
          width,
          height,
          nodes: useScene.getState().nodes,
        }) ?? localY
      const { clampedX, clampedY } = clampToWall(event.node, localX, snappedY, width, height)

      if (draftRef.current) {
        if (event.node.id !== draftRef.current.parentId) {
          log('reparent transient draft during wall:move', {
            ...eventDetails(event),
            fromWallId: draftRef.current.parentId,
            toWallId: event.node.id,
            clampedX,
            clampedY,
            side,
            itemRotation,
          })
          // Wall changed without enter/leave: must updateNode to reparent
          useScene.getState().updateNode(draftRef.current.id, {
            position: [clampedX, clampedY, 0],
            rotation: [0, itemRotation, 0],
            side,
            parentId: event.node.id,
            wallId: event.node.id,
          })
        } else {
          // Same wall: update Three.js mesh directly to avoid store churn
          const draftMesh = sceneRegistry.nodes.get(draftRef.current.id as AnyNodeId)
          if (draftMesh) {
            draftMesh.position.set(clampedX, clampedY, 0)
            draftMesh.rotation.set(0, itemRotation, 0)
            draftMesh.updateMatrixWorld(true)
          }
          markWallDirty(event.node.id)
        }
      }

      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        width,
        height,
        draftRef.current?.id,
      )
      lastPlacementRef.current = {
        wallId: event.node.id,
        clampedX,
        clampedY,
        side,
        itemRotation,
        valid,
      }
      if (!valid) {
        logSkip('move-overlap', 'wall:move placement invalid: overlaps existing wall child', {
          ...eventDetails(event),
          clampedX,
          clampedY,
          width,
          height,
          ignoredDraftId: draftRef.current?.id,
        })
      }

      updateCursor(
        wallLocalToWorld(
          event.node,
          clampedX,
          clampedY,
          getLevelYOffset(),
          getSlabElevation(event),
        ),
        cursorRotation,
        valid,
      )
      if (draftRef.current) {
        publishOpeningGuidesForWallEvent({
          wall: event.node,
          movingId: draftRef.current.id,
          centerS: clampedX,
          centerY: clampedY,
          width,
          height,
          includeVertical: true,
          levelYOffset: getLevelYOffset(),
          slabElevation: getSlabElevation(event),
        })
      }
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      const sceneDraft = draftRef.current
      const draft = sceneDraft ?? WindowNode.parse({})
      if (!sceneDraft) {
        log('wall:click continuing with defaults: transient draft was already cleared', {
          ...eventDetails(event),
          fallbackWidth: draft.width,
          fallbackHeight: draft.height,
        })
      }

      if (
        !isValidWallSideFace(event.normal) &&
        event.node.id !== lastPlacementRef.current?.wallId
      ) {
        log('wall:click ignored: invalid wall side face for a different wall', eventDetails(event))
        return
      }
      if (isCurvedWall(event.node)) {
        log('wall:click ignored: curved walls do not support windows yet', eventDetails(event))
        return
      }
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) {
        log('wall:click ignored: wall is not on active level', eventDetails(event))
        return
      }

      let placement = lastPlacementRef.current
      if (!placement || event.node.id !== placement.wallId) {
        const side = getSideFromNormal(event.normal)
        const itemRotation = calculateItemRotation(event.normal)
        const localX = snapToHalf(event.localPosition[0])
        const localY = snapToHalf(event.localPosition[1])
        const snappedY =
          resolveSillSnap({
            wall: event.node,
            movingId: sceneDraft?.id ?? '__window_preview__',
            localX,
            localY,
            width: draft.width,
            height: draft.height,
            nodes: useScene.getState().nodes,
          }) ?? localY
        const { clampedX, clampedY } = clampToWall(
          event.node,
          localX,
          snappedY,
          draft.width,
          draft.height,
        )
        const valid = !hasWallChildOverlap(
          event.node.id,
          clampedX,
          clampedY,
          draft.width,
          draft.height,
          sceneDraft?.id,
        )
        placement = {
          wallId: event.node.id,
          clampedX,
          clampedY,
          side,
          itemRotation,
          valid,
        }
      }

      if (!placement.valid) {
        log('wall:click ignored: wall placement is invalid', {
          ...eventDetails(event),
          placement,
        })
        return
      }

      const { clampedX, clampedY, side, itemRotation } = placement

      draftRef.current = null
      lastPlacementRef.current = null

      // Delete transient draft (paused, invisible to undo)
      if (sceneDraft) {
        useScene.getState().deleteNode(sceneDraft.id)
      }

      // Resume → create permanent node (single undoable action)
      useScene.temporal.getState().resume()

      const levelId = getLevelId()
      const state = useScene.getState()
      const windowCount = Object.values(state.nodes).filter((n) => {
        if (n.type !== 'window') return false
        const wall = n.parentId ? state.nodes[n.parentId as AnyNodeId] : undefined
        return wall?.parentId === levelId
      }).length
      const name = `Window ${windowCount + 1}`

      const node = WindowNode.parse({
        name,
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        width: draft.width,
        height: draft.height,
        windowType: draft.windowType,
        operationState: draft.operationState,
        awningDirection: draft.awningDirection,
        casementStyle: draft.casementStyle,
        hingesSide: draft.hingesSide,
        frameThickness: draft.frameThickness,
        frameDepth: draft.frameDepth,
        columnRatios: draft.columnRatios,
        rowRatios: draft.rowRatios,
        columnDividerThickness: draft.columnDividerThickness,
        rowDividerThickness: draft.rowDividerThickness,
        sill: draft.sill,
        sillDepth: draft.sillDepth,
        sillThickness: draft.sillThickness,
      })

      useScene.getState().createNode(node, event.node.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().pause()
      triggerSFX('sfx:item-place')
      clearOpeningGuides3D()
      log('created permanent window from wall:click', {
        wallId: event.node.id,
        windowId: node.id,
        position: node.position,
        rotation: node.rotation,
        side,
        name,
      })

      event.stopPropagation()
    }

    const onWallLeave = () => {
      destroyDraft()
      hideCursor()
    }

    const onCancel = () => {
      destroyDraft()
      lastPlacementRef.current = null
      hideCursor()
    }

    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('tool:cancel', onCancel)

    return () => {
      log('unmounted')
      destroyDraft()
      hideCursor()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [])

  // Cursor geometry: window outline rectangle (width × height × frameDepth)
  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(1.5, 1.5, 0.07)
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [])

  useEffect(() => () => edgesGeo.dispose(), [edgesGeo])

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments
        geometry={edgesGeo}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        ref={edgesRef}
      />
    </group>
  )
}

export default WindowTool
