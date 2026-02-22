import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  useScene,
  type WallEvent,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import {
  calculateCursorRotation,
  calculateItemRotation,
  getSideFromNormal,
  isValidWallSideFace,
  snapToHalf,
} from '../item/placement-math'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './window-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef4444,
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
export const MoveWindowTool: React.FC<{ node: WindowNode }> = ({ node: movingWindowNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  const exitMoveMode = () => {
    useEditor.getState().setMovingNode(null)
  }

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta = (typeof movingWindowNode.metadata === 'object' && movingWindowNode.metadata !== null)
      ? movingWindowNode.metadata as Record<string, unknown>
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

    if (!isNew) {
      // Move mode: mark the existing window as transient so it hides while being repositioned
      useScene.getState().updateNode(movingWindowNode.id, {
        metadata: { ...meta, isTransient: true },
      })
    }

    let currentWallId: string | null = movingWindowNode.parentId

    const markWallDirty = (wallId: string | null) => {
      if (wallId) useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
    }

    const getLevelYOffset = () => {
      const id = useViewer.getState().selection.levelId
      return id ? (sceneRegistry.nodes.get(id as AnyNodeId)?.position.y ?? 0) : 0
    }

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
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
      edgeMaterial.color.setHex(valid ? 0x22c55e : 0xef4444)
    }

    const onWallEnter = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX, localY,
        movingWindowNode.width, movingWindowNode.height,
      )

      const prevWallId = currentWallId
      currentWallId = event.node.id

      useScene.getState().updateNode(movingWindowNode.id, {
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        parentId: event.node.id,
        wallId: event.node.id,
      })

      if (prevWallId && prevWallId !== event.node.id) markWallDirty(prevWallId)
      markWallDirty(event.node.id)

      const valid = !hasWallChildOverlap(
        event.node.id, clampedX, clampedY,
        movingWindowNode.width, movingWindowNode.height,
        movingWindowNode.id,
      )

      updateCursor(wallLocalToWorld(event.node, clampedX, clampedY, getLevelYOffset()), cursorRotation, valid)
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX, localY,
        movingWindowNode.width, movingWindowNode.height,
      )

      useScene.getState().updateNode(movingWindowNode.id, {
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        parentId: event.node.id,
        wallId: event.node.id,
      })

      if (currentWallId !== event.node.id) {
        markWallDirty(currentWallId)
        currentWallId = event.node.id
      }
      markWallDirty(event.node.id)

      const valid = !hasWallChildOverlap(
        event.node.id, clampedX, clampedY,
        movingWindowNode.width, movingWindowNode.height,
        movingWindowNode.id,
      )

      updateCursor(wallLocalToWorld(event.node, clampedX, clampedY, getLevelYOffset()), cursorRotation, valid)
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX, localY,
        movingWindowNode.width, movingWindowNode.height,
      )

      const valid = !hasWallChildOverlap(
        event.node.id, clampedX, clampedY,
        movingWindowNode.width, movingWindowNode.height,
        movingWindowNode.id,
      )
      if (!valid) return

      let placedId: string

      if (isNew) {
        // Duplicate mode: delete transient + resume + createNode
        // Undo will remove the newly created node entirely
        useScene.getState().deleteNode(movingWindowNode.id)
        useScene.temporal.getState().resume()

        const node = WindowNode.parse({
          position: [clampedX, clampedY, 0],
          rotation: [0, itemRotation, 0],
          side,
          wallId: event.node.id,
          parentId: event.node.id,
          width: movingWindowNode.width,
          height: movingWindowNode.height,
          frameThickness: movingWindowNode.frameThickness,
          frameDepth: movingWindowNode.frameDepth,
          columnRatios: movingWindowNode.columnRatios,
          rowRatios: movingWindowNode.rowRatios,
          columnDividerThickness: movingWindowNode.columnDividerThickness,
          rowDividerThickness: movingWindowNode.rowDividerThickness,
          sill: movingWindowNode.sill,
          sillDepth: movingWindowNode.sillDepth,
          sillThickness: movingWindowNode.sillThickness,
        })
        useScene.getState().createNode(node, event.node.id as AnyNodeId)
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
          position: [clampedX, clampedY, 0],
          rotation: [0, itemRotation, 0],
          side,
          parentId: event.node.id,
          wallId: event.node.id,
          metadata: {},
        })

        if (original.parentId && original.parentId !== event.node.id) {
          markWallDirty(original.parentId)
        }
        placedId = movingWindowNode.id
      }

      markWallDirty(event.node.id)
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onWallLeave = () => {
      hideCursor()
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
      const current = useScene.getState().nodes[movingWindowNode.id as AnyNodeId] as WindowNode | undefined
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
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [movingWindowNode])

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
      <lineSegments geometry={edgesGeo} material={edgeMaterial} />
    </group>
  )
}
