import {
  type AnyNodeId,
  collectAlignmentAnchors,
  DoorNode,
  emitter,
  isCurvedWall,
  sceneRegistry,
  spatialGridManager,
  useAlignmentGuides,
  useLiveTransforms,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  EDITOR_LAYER,
  getSideFromNormal,
  isValidWallSideFace,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const MoveDoorTool: React.FC<{ node: DoorNode }> = ({ node: movingDoorNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof movingDoorNode.metadata === 'object' && movingDoorNode.metadata !== null
        ? (movingDoorNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    const original = {
      position: [...movingDoorNode.position] as [number, number, number],
      rotation: [...movingDoorNode.rotation] as [number, number, number],
      side: movingDoorNode.side,
      parentId: movingDoorNode.parentId,
      wallId: movingDoorNode.wallId,
      metadata: movingDoorNode.metadata,
    }

    if (!isNew) {
      useScene.getState().updateNode(movingDoorNode.id, {
        metadata: { ...meta, isTransient: true },
      })
    }

    let currentWallId: string | null = movingDoorNode.parentId
    let dragAnchor: { wallId: string; rawX: number; startX: number } | null = null
    let lastTarget: {
      wallNode: WallEvent['node']
      wallId: string
      side: DoorNode['side']
      itemRotation: number
      cursorRotation: number
      clampedX: number
      clampedY: number
      valid: boolean
      event: WallEvent
    } | null = null

    const markWallDirty = (wallId: string | null) => {
      if (wallId) useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
    }
    const lastWallDirtyAt = new Map<string, number>()
    const markWallDirtyThrottled = (wallId: string | null) => {
      if (!wallId) return
      const now = globalThis.performance?.now?.() ?? Date.now()
      const last = lastWallDirtyAt.get(wallId) ?? 0
      // Wall rebuilds can trigger expensive CSG; throttle live previews to avoid FPS collapse.
      if (now - last > 120) {
        lastWallDirtyAt.set(wallId, now)
        markWallDirty(wallId)
      }
    }

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

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      useAlignmentGuides.getState().clear()
    }

    // Alignment candidates — anchors of every OTHER alignable object (the
    // moving door is excluded so it never aligns to itself).
    const alignmentCandidates = collectAlignmentAnchors(
      useScene.getState().nodes,
      movingDoorNode.id,
    )

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

    const getPlacementOrientation = (event: WallEvent) => {
      const faceSide = getSideFromNormal(event.normal)
      const side = movingDoorNode.side ?? faceSide
      const rotationOffset = side !== faceSide ? Math.PI : 0
      return {
        side,
        itemRotation: calculateItemRotation(event.normal) + rotationOffset,
        cursorRotation:
          calculateCursorRotation(event.normal, event.node.start, event.node.end) + rotationOffset,
      }
    }

    const resolveMoveTarget = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) return

      const { side, itemRotation, cursorRotation } = getPlacementOrientation(event)

      const rawLocalX = event.localPosition[0]
      if (!dragAnchor || dragAnchor.wallId !== event.node.id) {
        dragAnchor = {
          wallId: event.node.id,
          rawX: rawLocalX,
          startX: event.node.id === original.parentId ? original.position[0] : rawLocalX,
        }
      }
      const targetLocalX = dragAnchor.startX + (rawLocalX - dragAnchor.rawX)
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: targetLocalX,
        width: movingDoorNode.width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })
      const { clampedX, clampedY } = clampToWall(
        event.node,
        localX,
        movingDoorNode.width,
        movingDoorNode.height,
      )

      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        movingDoorNode.width,
        movingDoorNode.height,
        movingDoorNode.id,
      )

      return {
        wallNode: event.node,
        wallId: event.node.id,
        side,
        itemRotation,
        cursorRotation,
        clampedX,
        clampedY,
        valid,
        event,
      }
    }

    const applyPreview = (target: NonNullable<typeof lastTarget>) => {
      if (currentWallId !== target.wallId) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
        })
        markWallDirty(currentWallId)
        currentWallId = target.wallId
      } else {
        const doorMesh = sceneRegistry.nodes.get(movingDoorNode.id as AnyNodeId)
        if (doorMesh) {
          doorMesh.position.set(target.clampedX, target.clampedY, 0)
          doorMesh.rotation.set(0, target.itemRotation, 0)
          doorMesh.updateMatrixWorld(true)
        }
      }
      useLiveTransforms.getState().set(movingDoorNode.id, {
        position: [target.clampedX, target.clampedY, 0],
        rotation: target.itemRotation,
      })
      markWallDirtyThrottled(target.wallId)

      updateCursor(
        wallLocalToWorld(
          target.wallNode,
          target.clampedX,
          target.clampedY,
          getLevelYOffset(),
          getSlabElevation(target.event),
        ),
        target.cursorRotation,
        target.valid,
      )
    }

    const onWallEnter = (event: WallEvent) => {
      const target = resolveMoveTarget(event)
      if (!target) return
      lastTarget = target
      applyPreview(target)
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) return

      const target = resolveMoveTarget(event)
      if (!target) return
      lastTarget = target
      applyPreview(target)
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) return
      if (event.node.parentId !== getLevelId()) return

      const target = lastTarget?.wallId === event.node.id ? lastTarget : resolveMoveTarget(event)
      if (!target?.valid) return

      let placedId: string

      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        useScene.temporal.getState().resume()

        const cloned = structuredClone(movingDoorNode) as any
        delete cloned.id
        const node = DoorNode.parse({
          ...cloned,
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          wallId: target.wallId,
          parentId: target.wallId,
        })
        useScene.getState().createNode(node, target.wallId as AnyNodeId)
        placedId = node.id
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          wallId: original.wallId,
          metadata: original.metadata,
        })
        useScene.temporal.getState().resume()

        useScene.getState().updateNode(movingDoorNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
          metadata: {},
        })

        if (original.parentId && original.parentId !== target.wallId) {
          markWallDirty(original.parentId)
        }
        placedId = movingDoorNode.id
      }

      markWallDirty(target.wallId)
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useScene.temporal.getState().pause()

      triggerSFX('sfx:structure-build')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onWallLeave = () => {
      hideCursor()
      useLiveTransforms.getState().clear(movingDoorNode.id)
      dragAnchor = null
      lastTarget = null
      if (isNew) return
      if (currentWallId && currentWallId !== original.parentId) {
        markWallDirty(currentWallId)
      }
      currentWallId = original.parentId
      useScene.getState().updateNode(movingDoorNode.id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        wallId: original.wallId,
      })
      if (original.parentId) markWallDirty(original.parentId)
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(movingDoorNode.id)
      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        if (currentWallId) markWallDirty(currentWallId)
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          wallId: original.wallId,
          metadata: original.metadata,
        })
        if (original.parentId) markWallDirty(original.parentId)
      }
      useScene.temporal.getState().resume()
      hideCursor()
      exitMoveMode()
    }

    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('tool:cancel', onCancel)

    return () => {
      const current = useScene.getState().nodes[movingDoorNode.id as AnyNodeId] as
        | DoorNode
        | undefined
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (currentMeta?.isTransient) {
        if (isNew) {
          useScene.getState().deleteNode(movingDoorNode.id)
          if (currentWallId) markWallDirty(currentWallId)
        } else {
          useScene.getState().updateNode(movingDoorNode.id, {
            position: original.position,
            rotation: original.rotation,
            side: original.side,
            parentId: original.parentId,
            wallId: original.wallId,
            metadata: original.metadata,
          })
          if (original.parentId) markWallDirty(original.parentId)
        }
      }
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [movingDoorNode, exitMoveMode])

  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(
      movingDoorNode.width,
      movingDoorNode.height,
      movingDoorNode.frameDepth ?? 0.07,
    )
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [movingDoorNode])

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER} material={edgeMaterial} />
    </group>
  )
}

export default MoveDoorTool
