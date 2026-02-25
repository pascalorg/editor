import {
  type AnyNodeId,
  DoorNode,
  emitter,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallEvent,
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
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef4444,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

export const MoveDoorTool: React.FC<{ node: DoorNode }> = ({ node: movingDoorNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  const exitMoveMode = () => {
    useEditor.getState().setMovingNode(null)
  }

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta = (typeof movingDoorNode.metadata === 'object' && movingDoorNode.metadata !== null)
      ? movingDoorNode.metadata as Record<string, unknown>
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

    const markWallDirty = (wallId: string | null) => {
      if (wallId) useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
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
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX,
        movingDoorNode.width, movingDoorNode.height,
      )

      const prevWallId = currentWallId
      currentWallId = event.node.id

      useScene.getState().updateNode(movingDoorNode.id, {
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
        movingDoorNode.width, movingDoorNode.height,
        movingDoorNode.id,
      )

      updateCursor(
        wallLocalToWorld(event.node, clampedX, clampedY, getLevelYOffset(), getSlabElevation(event)),
        cursorRotation,
        valid,
      )
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX,
        movingDoorNode.width, movingDoorNode.height,
      )

      useScene.getState().updateNode(movingDoorNode.id, {
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
        movingDoorNode.width, movingDoorNode.height,
        movingDoorNode.id,
      )

      updateCursor(
        wallLocalToWorld(event.node, clampedX, clampedY, getLevelYOffset(), getSlabElevation(event)),
        cursorRotation,
        valid,
      )
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)

      const localX = snapToHalf(event.localPosition[0])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX,
        movingDoorNode.width, movingDoorNode.height,
      )

      const valid = !hasWallChildOverlap(
        event.node.id, clampedX, clampedY,
        movingDoorNode.width, movingDoorNode.height,
        movingDoorNode.id,
      )
      if (!valid) return

      let placedId: string

      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        useScene.temporal.getState().resume()

        const node = DoorNode.parse({
          position: [clampedX, clampedY, 0],
          rotation: [0, itemRotation, 0],
          side,
          wallId: event.node.id,
          parentId: event.node.id,
          width: movingDoorNode.width,
          height: movingDoorNode.height,
          frameThickness: movingDoorNode.frameThickness,
          frameDepth: movingDoorNode.frameDepth,
          threshold: movingDoorNode.threshold,
          thresholdHeight: movingDoorNode.thresholdHeight,
          hingesSide: movingDoorNode.hingesSide,
          swingDirection: movingDoorNode.swingDirection,
          segments: movingDoorNode.segments,
          handle: movingDoorNode.handle,
          handleHeight: movingDoorNode.handleHeight,
          handleSide: movingDoorNode.handleSide,
          doorCloser: movingDoorNode.doorCloser,
          panicBar: movingDoorNode.panicBar,
          panicBarHeight: movingDoorNode.panicBarHeight,
        })
        useScene.getState().createNode(node, event.node.id as AnyNodeId)
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
        placedId = movingDoorNode.id
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
      const current = useScene.getState().nodes[movingDoorNode.id as AnyNodeId] as DoorNode | undefined
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
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [movingDoorNode])

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
      <lineSegments geometry={edgesGeo} material={edgeMaterial} />
    </group>
  )
}
