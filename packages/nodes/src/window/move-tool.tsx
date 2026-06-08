import {
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  isCurvedWall,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
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
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './window-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

/**
 * Move/duplicate tool for WindowNodes — wall-only, same guardrails as WindowTool.
 *
 * Move mode (metadata.isNew falsy):
 *   Adopts the existing window, pauses temporal. On commit: restores original state
 *   (clean undo baseline) then resumes + updateNode (undo reverts to original position).
 *   On cancel: restores original state.
 *
 * Duplicate mode (metadata.isNew = true):
 *   The node is a freshly created transient copy. On commit: deletes transient + resumes
 *   + createNode (undo removes the new window entirely). On cancel: deletes the node.
 */
const MoveWindowTool: React.FC<{ node: WindowNode }> = ({ node: movingWindowNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof movingWindowNode.metadata === 'object' && movingWindowNode.metadata !== null
        ? (movingWindowNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    // Save original state (only used in move mode)
    const original = {
      position: [...movingWindowNode.position] as [number, number, number],
      rotation: [...movingWindowNode.rotation] as [number, number, number],
      side: movingWindowNode.side,
      parentId: movingWindowNode.parentId,
      wallId: movingWindowNode.wallId,
      metadata: movingWindowNode.metadata,
    }

    // In move mode (existing window) mark it transient so its mesh skips the live wall CSG
    // rebuild while repositioning — the editor requests a final rebuild on commit. For a new
    // placement (preset/duplicate) we must NOT mark it transient: WindowSystem only rebuilds
    // the host wall's cutout for non-transient windows, so a transient draft shows no live
    // preview on the wall and can't be placed consecutively without leaving/re-entering. This
    // mirrors MoveDoorTool.
    if (!isNew) {
      useScene.getState().updateNode(movingWindowNode.id, {
        metadata: { ...meta, isTransient: true },
      })
    }

    let currentWallId: string | null = movingWindowNode.parentId
    let dragAnchor: {
      wallId: string
      rawX: number
      rawY: number
      startX: number
      startY: number
    } | null = null
    let lastTarget: {
      wallNode: WallEvent['node']
      wallId: string
      side: WindowNode['side']
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
    // moving window is excluded so it never aligns to itself). Along-wall only;
    // the floor-plane guides don't cover sill height.
    const alignmentCandidates = collectAlignmentAnchors(
      useScene.getState().nodes,
      movingWindowNode.id,
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

    const resolveMoveTarget = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const rawLocalX = event.localPosition[0]
      const rawLocalY = event.localPosition[1]
      if (!dragAnchor || dragAnchor.wallId !== event.node.id) {
        dragAnchor = {
          wallId: event.node.id,
          rawX: rawLocalX,
          rawY: rawLocalY,
          startX: event.node.id === original.parentId ? original.position[0] : rawLocalX,
          startY:
            event.node.id === original.parentId ? original.position[1] : snapToHalf(rawLocalY),
        }
      }
      const targetLocalX = dragAnchor.startX + (rawLocalX - dragAnchor.rawX)
      const targetLocalY = snapToHalf(dragAnchor.startY + (rawLocalY - dragAnchor.rawY))
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: targetLocalX,
        width: movingWindowNode.width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })
      const { clampedX, clampedY } = clampToWall(
        event.node,
        localX,
        targetLocalY,
        movingWindowNode.width,
        movingWindowNode.height,
      )

      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        movingWindowNode.width,
        movingWindowNode.height,
        movingWindowNode.id,
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
        useScene.getState().updateNode(movingWindowNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
        })
        markWallDirty(currentWallId)
        currentWallId = target.wallId
      } else {
        const windowMesh = sceneRegistry.nodes.get(movingWindowNode.id as AnyNodeId)
        if (windowMesh) {
          windowMesh.position.set(target.clampedX, target.clampedY, 0)
          windowMesh.rotation.set(0, target.itemRotation, 0)
          windowMesh.updateMatrixWorld(true)
        }
      }
      useLiveTransforms.getState().set(movingWindowNode.id, {
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
      // Only interact with walls on the current level
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
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) return

      const target = lastTarget?.wallId === event.node.id ? lastTarget : resolveMoveTarget(event)
      if (!target?.valid) return

      let placedId: string

      if (isNew) {
        // Duplicate mode: delete transient + resume + createNode
        // Undo will remove the newly created node entirely
        useScene.getState().deleteNode(movingWindowNode.id)
        useScene.temporal.getState().resume()

        const cloned = structuredClone(movingWindowNode) as any
        delete cloned.id
        if (cloned.metadata && typeof cloned.metadata === 'object') {
          delete cloned.metadata.isNew
          delete cloned.metadata.isTransient
        }

        const node = WindowNode.parse({
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
        // Move mode: restore original (clean baseline) + resume + updateNode
        // Undo will revert to the original position
        useScene.getState().updateNode(movingWindowNode.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          wallId: original.wallId,
          metadata: original.metadata,
        })
        useScene.temporal.getState().resume()

        useScene.getState().updateNode(movingWindowNode.id, {
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
        placedId = movingWindowNode.id
      }

      markWallDirty(target.wallId)
      useLiveTransforms.getState().clear(movingWindowNode.id)
      useScene.temporal.getState().pause()

      triggerSFX('sfx:structure-build')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onWallLeave = () => {
      hideCursor()
      useLiveTransforms.getState().clear(movingWindowNode.id)
      dragAnchor = null
      lastTarget = null
      if (isNew) return // No original to restore for duplicates
      // Move mode: restore to original position while off-wall
      if (currentWallId && currentWallId !== original.parentId) {
        markWallDirty(currentWallId)
      }
      currentWallId = original.parentId
      useScene.getState().updateNode(movingWindowNode.id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        wallId: original.wallId,
      })
      if (original.parentId) markWallDirty(original.parentId)
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(movingWindowNode.id)
      if (isNew) {
        useScene.getState().deleteNode(movingWindowNode.id)
        if (currentWallId) markWallDirty(currentWallId)
      } else {
        useScene.getState().updateNode(movingWindowNode.id, {
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
      // Safety cleanup: if still transient on unmount (e.g. phase switch mid-move)
      const current = useScene.getState().nodes[movingWindowNode.id as AnyNodeId] as
        | WindowNode
        | undefined
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (currentMeta?.isTransient) {
        if (isNew) {
          useScene.getState().deleteNode(movingWindowNode.id)
          if (currentWallId) markWallDirty(currentWallId)
        } else {
          useScene.getState().updateNode(movingWindowNode.id, {
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
      useLiveTransforms.getState().clear(movingWindowNode.id)
      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [movingWindowNode, exitMoveMode])

  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(
      movingWindowNode.width,
      movingWindowNode.height,
      movingWindowNode.frameDepth ?? 0.07,
    )
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [movingWindowNode])

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER} material={edgeMaterial} />
    </group>
  )
}

export default MoveWindowTool
