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
import { useEffect, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, type LineSegments } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
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

/**
 * Door tool — places DoorNodes on walls only.
 * Doors always sit at floor level (clampedY = height/2).
 */
export const DoorTool: React.FC = () => {
  const draftRef = useRef<DoorNode | null>(null)
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

    const destroyDraft = () => {
      if (!draftRef.current) return
      const wallId = draftRef.current.parentId
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
      if (wallId) markWallDirty(wallId)
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
      const levelId = getLevelId()
      if (!levelId) return
      if (event.node.parentId !== levelId) return

      destroyDraft()

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const width = 0.9
      const height = 2.1

      const { clampedX, clampedY } = clampToWall(event.node, localX, width, height)

      const node = DoorNode.parse({
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
      const width = draftRef.current?.width ?? 0.9
      const height = draftRef.current?.height ?? 2.1

      const { clampedX, clampedY } = clampToWall(event.node, localX, width, height)

      if (draftRef.current) {
        useScene.getState().updateNode(draftRef.current.id, {
          position: [clampedX, clampedY, 0],
          rotation: [0, itemRotation, 0],
          side,
          parentId: event.node.id,
          wallId: event.node.id,
        })
      }

      const valid = !hasWallChildOverlap(
        event.node.id, clampedX, clampedY, width, height,
        draftRef.current?.id,
      )

      updateCursor(
        wallLocalToWorld(event.node, clampedX, clampedY, getLevelYOffset(), getSlabElevation(event)),
        cursorRotation,
        valid,
      )
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!draftRef.current) return
      if (!isValidWallSideFace(event.normal)) return
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)

      const localX = snapToHalf(event.localPosition[0])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX,
        draftRef.current.width, draftRef.current.height,
      )
      const valid = !hasWallChildOverlap(
        event.node.id, clampedX, clampedY,
        draftRef.current.width, draftRef.current.height,
        draftRef.current.id,
      )
      if (!valid) return

      const draft = draftRef.current
      draftRef.current = null

      useScene.getState().deleteNode(draft.id)
      useScene.temporal.getState().resume()

      const node = DoorNode.parse({
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        width: draft.width,
        height: draft.height,
        frameThickness: draft.frameThickness,
        frameDepth: draft.frameDepth,
        threshold: draft.threshold,
        thresholdHeight: draft.thresholdHeight,
        hingesSide: draft.hingesSide,
        swingDirection: draft.swingDirection,
        segments: draft.segments,
        handle: draft.handle,
        handleHeight: draft.handleHeight,
        handleSide: draft.handleSide,
        doorCloser: draft.doorCloser,
        panicBar: draft.panicBar,
        panicBarHeight: draft.panicBarHeight,
      })

      useScene.getState().createNode(node, event.node.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().pause()

      event.stopPropagation()
    }

    const onWallLeave = () => {
      destroyDraft()
      hideCursor()
    }

    const onCancel = () => {
      destroyDraft()
      hideCursor()
    }

    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('tool:cancel', onCancel)

    return () => {
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

  // Cursor geometry: door outline (default 0.9 × 2.1 × 0.07)
  const boxGeo = new BoxGeometry(0.9, 2.1, 0.07)
  const edgesGeo = new EdgesGeometry(boxGeo)
  boxGeo.dispose()

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments ref={edgesRef} geometry={edgesGeo} material={edgeMaterial} />
    </group>
  )
}
