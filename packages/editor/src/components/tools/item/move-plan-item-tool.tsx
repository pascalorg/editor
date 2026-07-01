'use client'

import '../../../three-types'

import {
  type AnyNodeId,
  emitter,
  getScaledDimensions,
  type ItemNode,
  isCurvedWall,
  resolveLevelId,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { lastGridMoveRef } from '../../../hooks/use-grid-events'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { floorItemDragSuppressClickRef } from '../../../lib/floor-item-drag'
import {
  clearPlanDragLiveTransform,
  schedulePlanDragLiveTransform,
} from '../../../lib/plan-drag-live'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { getGridAlignedDimensions, snapToGrid, snapToHalf } from './placement-math'

function snapFloorItemXZ(node: ItemNode, localX: number, localZ: number): [number, number] {
  const dims = getGridAlignedDimensions(getScaledDimensions(node), undefined)
  const rotY = node.rotation[1]
  const swapDims = Math.abs(Math.sin(rotY)) > 0.9
  const x = snapToGrid(localX, swapDims ? dims[2] : dims[0])
  const z = snapToGrid(localZ, swapDims ? dims[0] : dims[2])
  return [x, z]
}

function getFloorItemMeshY(node: ItemNode, planX: number, planZ: number): number {
  const nodes = useScene.getState().nodes
  const levelId = resolveLevelId(node, nodes)
  if (!levelId) return node.position[1]

  const slabElevation = spatialGridManager.getSlabElevationForItem(
    levelId,
    [planX, node.position[1], planZ],
    getScaledDimensions(node),
    node.rotation,
  )
  return slabElevation + node.position[1]
}

function buildingLocalToParentLocal(
  parentId: AnyNodeId,
  buildingLocal: [number, number, number],
): Vector3 | null {
  const buildingId = useViewer.getState().selection.buildingId
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  const parentMesh = sceneRegistry.nodes.get(parentId)
  if (!parentMesh) return null
  const world = buildingMesh
    ? buildingMesh.localToWorld(new Vector3(...buildingLocal))
    : new Vector3(...buildingLocal)
  return parentMesh.worldToLocal(world)
}

function parentLocalToBuildingLocal(
  parentId: AnyNodeId | null | undefined,
  parentLocal: [number, number, number],
): Vector3 {
  const buildingId = useViewer.getState().selection.buildingId
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  const local = new Vector3(...parentLocal)
  const parentMesh = parentId ? sceneRegistry.nodes.get(parentId) : null
  const world = parentMesh ? parentMesh.localToWorld(local) : local
  return buildingMesh ? buildingMesh.worldToLocal(world) : world
}

function applyDragOffset(
  localPosition: [number, number, number],
  offset: [number, number, number],
): [number, number, number] {
  return [
    localPosition[0] + offset[0],
    localPosition[1] + offset[1],
    localPosition[2] + offset[2],
  ]
}

function computeWallLocalPosition(
  wall: WallNode,
  node: ItemNode,
  planX: number,
  planZ: number,
  preserveY: number,
): [number, number, number] {
  if (isCurvedWall(wall)) {
    return [node.position[0], preserveY, node.position[2]]
  }

  const sx = wall.start[0]
  const sz = wall.start[1]
  const dx = wall.end[0] - sx
  const dz = wall.end[1] - sz
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < 1e-6) {
    return [node.position[0], preserveY, node.position[2]]
  }

  const dirX = dx / wallLength
  const dirZ = dz / wallLength
  let localX = (planX - sx) * dirX + (planZ - sz) * dirZ
  localX = snapToHalf(localX)

  const [width] = getScaledDimensions(node)
  const halfW = width / 2
  localX = Math.max(halfW, Math.min(wallLength - halfW, localX))

  return [localX, preserveY, node.position[2]]
}

function computeDragPosition(
  node: ItemNode,
  buildingLocal: [number, number, number],
  preserveY: number,
): [number, number, number] {
  const nodes = useScene.getState().nodes
  const attachTo = node.asset.attachTo
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null

  if (attachTo === 'wall' || attachTo === 'wall-side') {
    if (parent?.type === 'wall') {
      return computeWallLocalPosition(
        parent as WallNode,
        node,
        buildingLocal[0],
        buildingLocal[2],
        preserveY,
      )
    }
    return [node.position[0], preserveY, node.position[2]]
  }

  if (attachTo === 'ceiling') {
    if (parent && node.parentId) {
      const local = buildingLocalToParentLocal(node.parentId as AnyNodeId, buildingLocal)
      if (local) {
        const dims = getGridAlignedDimensions(getScaledDimensions(node), attachTo)
        const x = snapToGrid(local.x, dims[0])
        const z = snapToGrid(local.z, dims[2])
        return [x, preserveY, z]
      }
    }
    return [node.position[0], preserveY, node.position[2]]
  }

  if (parent?.type === 'level' || !parent) {
    const [x, z] = snapFloorItemXZ(node, buildingLocal[0], buildingLocal[2])
    return [x, preserveY, z]
  }

  if (node.parentId) {
    const local = buildingLocalToParentLocal(node.parentId as AnyNodeId, buildingLocal)
    if (local) {
      const dims = getGridAlignedDimensions(getScaledDimensions(node), undefined)
      const rotY = node.rotation[1]
      const swapDims = Math.abs(Math.sin(rotY)) > 0.9
      const x = snapToGrid(local.x, swapDims ? dims[2] : dims[0])
      const z = snapToGrid(local.z, swapDims ? dims[0] : dims[2])
      return [x, preserveY, z]
    }
  }

  return [node.position[0], preserveY, node.position[2]]
}

function applyMeshPreview(
  node: ItemNode,
  position: [number, number, number],
  originalRotationY: number,
  resolveMeshY?: (x: number, z: number) => number,
) {
  const mesh = sceneRegistry.nodes.get(node.id)
  if (!mesh) return

  const nodes = useScene.getState().nodes
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  const isLevelFloor = !node.asset.attachTo && (parent?.type === 'level' || !parent)

  if (isLevelFloor) {
    const meshY = resolveMeshY
      ? resolveMeshY(position[0], position[2])
      : getFloorItemMeshY(node, position[0], position[2])
    mesh.position.set(position[0], meshY, position[2])
  } else {
    mesh.position.set(position[0], position[1], position[2])
  }

  schedulePlanDragLiveTransform(node.id, {
    position,
    rotation: originalRotationY,
  })
}

function restoreMeshPreview(node: ItemNode, position: [number, number, number]) {
  applyMeshPreview(node, position, node.rotation[1])
}

/**
 * Unified drag-to-move for scene items. Only updates horizontal placement
 * (plan X/Z or parent-local X/Z); Y is preserved and should be edited via
 * the inspector panel. Does not reparent or switch attach surfaces.
 */
export function MovePlanItemTool({ node }: { node: ItemNode }) {
  const originalPosition = useMemo(() => [...node.position] as [number, number, number], [node])
  const originalRotationY = node.rotation[1]
  const lastPositionRef = useRef<[number, number, number]>(originalPosition)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    if (useEditor.getState().isFloorplanHovered) return

    const previousInputDragging = useViewer.getState().inputDragging
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    let committed = false
    const meshYCache = new Map<string, number>()
    const resolveMeshY = (x: number, z: number) => {
      const key = `${x},${z}`
      const cached = meshYCache.get(key)
      if (cached !== undefined) return cached
      const y = getFloorItemMeshY(node, x, z)
      meshYCache.set(key, y)
      return y
    }

    const mesh = sceneRegistry.nodes.get(node.id)
    const restoreRaycasts: Array<() => void> = []
    if (mesh) {
      mesh.traverse((child) => {
        const original = child.raycast
        child.raycast = () => {}
        restoreRaycasts.push(() => {
          child.raycast = original
        })
      })
    }

    const applyPosition = (position: [number, number, number]) => {
      lastPositionRef.current = position
      applyMeshPreview(node, position, originalRotationY, resolveMeshY)
    }

    const initialCursor = lastGridMoveRef.localPosition
    const originalBuildingLocal = parentLocalToBuildingLocal(
      node.parentId as AnyNodeId | null | undefined,
      originalPosition,
    )
    const dragOffset: [number, number, number] = initialCursor
      ? [
          originalBuildingLocal.x - initialCursor[0],
          originalBuildingLocal.y - initialCursor[1],
          originalBuildingLocal.z - initialCursor[2],
        ]
      : [0, 0, 0]

    const onGridMove = (event: { localPosition: [number, number, number] }) => {
      const position = computeDragPosition(
        node,
        applyDragOffset(event.localPosition, dragOffset),
        originalPosition[1],
      )
      applyPosition(position)
    }

    if (lastGridMoveRef.localPosition) {
      onGridMove({ localPosition: lastGridMoveRef.localPosition })
    }

    const commitAtCursor = () => {
      if (committed) return
      const position: [number, number, number] = [...lastPositionRef.current]

      if (useScene.getState().nodes[node.id]) {
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(node.id, { position })
        useScene.getState().dirtyNodes.add(node.id)
        if (
          (node.asset.attachTo === 'wall' || node.asset.attachTo === 'wall-side') &&
          node.parentId
        ) {
          useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
        }
        useScene.temporal.getState().pause()
        committed = true
      }

      applyMeshPreview(node, position, originalRotationY, resolveMeshY)
      clearPlanDragLiveTransform(node.id)
      floorItemDragSuppressClickRef.current = true
      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      restoreMeshPreview(node, originalPosition)
      clearPlanDragLiveTransform(node.id)
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    window.addEventListener('pointerup', onPointerUp)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      window.removeEventListener('pointerup', onPointerUp)
      emitter.off('tool:cancel', onCancel)
      useViewer.getState().setInputDragging(previousInputDragging)
      for (const restore of restoreRaycasts) restore()
      if (!committed) {
        restoreMeshPreview(node, originalPosition)
        clearPlanDragLiveTransform(node.id)
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node, originalPosition, originalRotationY])

  return null
}
