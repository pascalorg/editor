import {
  type AnyNodeId,
  emitter,
  type ItemNode,
  useScene,
  type WallEvent,
  type WallNode,
  WindowNode,
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

// Shared edge material — reuse across renders, just toggle color
const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef4444, // red-500 default (invalid)
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

/**
 * Converts wall-local (X along wall, Y = height) to world XYZ.
 * Wall-local Y maps directly to world Y; X maps along the wall direction.
 */
function wallLocalToWorld(
  wallNode: WallNode,
  localX: number,
  localY: number,
): [number, number, number] {
  const wallAngle = Math.atan2(
    wallNode.end[1] - wallNode.start[1],
    wallNode.end[0] - wallNode.start[0],
  )
  return [
    wallNode.start[0] + localX * Math.cos(wallAngle),
    localY,
    wallNode.start[1] + localX * Math.sin(wallAngle),
  ]
}

/**
 * Clamps window center position so it stays fully within wall bounds.
 */
function clampToWall(
  wallNode: WallNode,
  localX: number,
  localY: number,
  width: number,
  height: number,
): { clampedX: number; clampedY: number } {
  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.sqrt(dx * dx + dz * dz)
  const wallHeight = wallNode.height ?? 2.5

  const clampedX = Math.max(width / 2, Math.min(wallLength - width / 2, localX))
  const clampedY = Math.max(height / 2, Math.min(wallHeight - height / 2, localY))
  return { clampedX, clampedY }
}

/**
 * Directly checks the wall's children for bounding-box overlap with a proposed window.
 * Works for both `item` type (position[1] = bottom) and `window` type (position[1] = center).
 * The spatial grid only tracks `item` nodes, so windows must be checked this way.
 * Reads the wall's latest children from the store (not the event node) to avoid stale data.
 */
function hasWallChildOverlap(
  wallId: string,
  clampedX: number,
  clampedY: number,
  width: number,
  height: number,
  ignoreId?: string,
): boolean {
  const nodes = useScene.getState().nodes
  const wallNode = nodes[wallId as AnyNodeId] as WallNode | undefined
  if (!wallNode) return true // Block if wall not found
  const halfW = width / 2
  const halfH = height / 2
  const newBottom = clampedY - halfH
  const newTop = clampedY + halfH
  const newLeft = clampedX - halfW
  const newRight = clampedX + halfW

  for (const childId of wallNode.children) {
    if (childId === ignoreId) continue
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    let childLeft: number, childRight: number, childBottom: number, childTop: number

    if (child.type === 'item') {
      const item = child as ItemNode
      if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') continue
      const [w, h] = item.asset.dimensions
      childLeft = item.position[0] - w / 2
      childRight = item.position[0] + w / 2
      childBottom = item.position[1]       // items store bottom Y
      childTop = item.position[1] + h
    } else if (child.type === 'window') {
      const win = child as WindowNode
      childLeft = win.position[0] - win.width / 2
      childRight = win.position[0] + win.width / 2
      childBottom = win.position[1] - win.height / 2  // windows store center Y
      childTop = win.position[1] + win.height / 2
    } else {
      continue
    }

    const xOverlap = newLeft < childRight && newRight > childLeft
    const yOverlap = newBottom < childTop && newTop > childBottom
    if (xOverlap && yOverlap) return true
  }

  return false
}

/**
 * Window tool — places WindowNodes on walls only.
 * Shows a rectangle cursor (green = valid, red = invalid) matching window dimensions.
 */
export const WindowTool: React.FC = () => {
  const draftRef = useRef<WindowNode | null>(null)
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)

  useEffect(() => {
    useScene.temporal.getState().pause()

    const getLevelId = () => useViewer.getState().selection.levelId

    const markWallDirty = (wallId: string) => {
      useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
    }

    const destroyDraft = () => {
      if (!draftRef.current) return
      const wallId = draftRef.current.parentId
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
      // Rebuild wall so it removes the cutout from the deleted draft
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

      destroyDraft()

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])

      const width = 1.5
      const height = 1.5

      const { clampedX, clampedY } = clampToWall(event.node, localX, localY, width, height)

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

      updateCursor(wallLocalToWorld(event.node, clampedX, clampedY), cursorRotation, valid)
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])

      const width = draftRef.current?.width ?? 1.5
      const height = draftRef.current?.height ?? 1.5

      const { clampedX, clampedY } = clampToWall(event.node, localX, localY, width, height)

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

      updateCursor(wallLocalToWorld(event.node, clampedX, clampedY), cursorRotation, valid)
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!draftRef.current) return
      if (!isValidWallSideFace(event.normal)) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)

      const localX = snapToHalf(event.localPosition[0])
      const localY = snapToHalf(event.localPosition[1])
      const { clampedX, clampedY } = clampToWall(
        event.node, localX, localY,
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

      // Delete transient draft (paused, invisible to undo)
      useScene.getState().deleteNode(draft.id)

      // Resume → create permanent node (single undoable action)
      useScene.temporal.getState().resume()

      const node = WindowNode.parse({
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        width: draft.width,
        height: draft.height,
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

  // Cursor geometry: window outline rectangle (width × height × frameDepth)
  const boxGeo = new BoxGeometry(1.5, 1.5, 0.07)
  const edgesGeo = new EdgesGeometry(boxGeo)
  boxGeo.dispose()

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments ref={edgesRef} geometry={edgesGeo} material={edgeMaterial} />
    </group>
  )
}
