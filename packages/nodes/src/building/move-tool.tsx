'use client'

import {
  type BuildingNode,
  emitter,
  type GridEvent,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

const Y_AXIS = new THREE.Vector3(0, 1, 0)

export function MoveBuildingContent({ node }: { node: BuildingNode }) {
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const dragAnchorRef = useRef<[number, number] | null>(null)

  // Stable refs so the effect never needs node in its dependency array
  const nodeIdRef = useRef(node.id)
  const originalPositionRef = useRef<[number, number, number]>([...node.position] as [
    number,
    number,
    number,
  ])
  const originalRotationRef = useRef<number>(node.rotation[1] ?? 0)
  const pendingRotationRef = useRef<number>(node.rotation[1] ?? 0)

  // Local-space offset from the building's origin to its bbox center. The
  // move preview preserves the first pointer-to-center delta, then uses this
  // offset to write the origin while keeping rotation around the visual center.
  const centerOffsetLocalRef = useRef<THREE.Vector3>(new THREE.Vector3())

  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>(() => {
    const obj = sceneRegistry.nodes.get(node.id)
    if (obj) {
      const box = new THREE.Box3().setFromObject(obj)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        const originWorld = new THREE.Vector3()
        obj.getWorldPosition(originWorld)
        const originalRotation = node.rotation[1] ?? 0
        centerOffsetLocalRef.current = center
          .clone()
          .sub(originWorld)
          .applyAxisAngle(Y_AXIS, -originalRotation)
        return [center.x, 0, center.z]
      }
      const pos = new THREE.Vector3()
      obj.getWorldPosition(pos)
      return [pos.x, pos.y, pos.z]
    }
    return [node.position[0], node.position[1], node.position[2]]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const nodeId = nodeIdRef.current
    const originalPosition = originalPositionRef.current
    const offsetWork = new THREE.Vector3()
    const offsetAt = (rotationY: number) =>
      offsetWork.copy(centerOffsetLocalRef.current).applyAxisAngle(Y_AXIS, rotationY)
    const originalCenterOffset = offsetAt(originalRotationRef.current).clone()
    const originalCenter: [number, number] = [
      originalPosition[0] + originalCenterOffset.x,
      originalPosition[2] + originalCenterOffset.z,
    ]

    useScene.temporal.getState().pause()
    dragAnchorRef.current = null
    previousGridPosRef.current = null

    // Publish the building's current pose to useLiveTransforms so the
    // floor-plan (and any other live consumers) can follow per-frame
    // without peeking into the Three.js mesh.
    const publishLive = (posX: number, posZ: number, rotY: number) => {
      useLiveTransforms.getState().set(nodeId, {
        position: [posX, originalPosition[1], posZ],
        rotation: rotY,
      })
    }

    let wasCommitted = false

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        triggerSFX('sfx:item-rotate')
        pendingRotationRef.current += rotationDelta

        const mesh = sceneRegistry.nodes.get(nodeId)
        if (mesh) {
          mesh.rotation.y = pendingRotationRef.current
          // Keep the bbox center pinned to the cursor through rotation.
          if (previousGridPosRef.current) {
            const [gridX, gridZ] = previousGridPosRef.current
            const off = offsetAt(pendingRotationRef.current)
            mesh.position.x = gridX - off.x
            mesh.position.z = gridZ - off.z
            publishLive(mesh.position.x, mesh.position.z, pendingRotationRef.current)
          } else {
            publishLive(mesh.position.x, mesh.position.z, pendingRotationRef.current)
          }
        }
      }
    }

    const onGridMove = (event: GridEvent) => {
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const rawX = bypassSnap ? event.position[0] : Math.round(event.position[0] * 2) / 2
      const rawZ = bypassSnap ? event.position[2] : Math.round(event.position[2] * 2) / 2
      const anchor = dragAnchorRef.current ?? [rawX, rawZ]
      dragAnchorRef.current = anchor
      const gridX = originalCenter[0] + (rawX - anchor[0])
      const gridZ = originalCenter[1] + (rawZ - anchor[1])

      if (
        !bypassSnap &&
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
      setCursorWorldPos([gridX, 0, gridZ])

      // Directly update the Three.js group — no store update during drag
      const mesh = sceneRegistry.nodes.get(nodeId)
      if (mesh) {
        const off = offsetAt(pendingRotationRef.current)
        mesh.position.x = gridX - off.x
        mesh.position.z = gridZ - off.z
        publishLive(mesh.position.x, mesh.position.z, pendingRotationRef.current)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (wasCommitted) return
      const [gridX, gridZ] = previousGridPosRef.current ?? originalCenter

      wasCommitted = true

      const off = offsetAt(pendingRotationRef.current)
      useScene.temporal.getState().resume()
      useScene.getState().updateNode(nodeId, {
        position: [gridX - off.x, originalPosition[1], gridZ - off.z],
        rotation: [0, pendingRotationRef.current, 0],
      })
      useScene.temporal.getState().pause()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ buildingId: nodeId as BuildingNode['id'] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      onGridClick({ nativeEvent: event } as unknown as GridEvent)
    }

    const onCancel = () => {
      // Revert mesh position and rotation immediately
      const mesh = sceneRegistry.nodes.get(nodeId)
      if (mesh) {
        mesh.position.x = originalPosition[0]
        mesh.position.z = originalPosition[2]
        mesh.rotation.y = originalRotationRef.current
      }
      pendingRotationRef.current = originalRotationRef.current
      // Restore building selection
      useViewer.getState().setSelection({ buildingId: nodeId as BuildingNode['id'] })
      useScene.temporal.getState().resume()
      // Tell the keyboard handler we handled this, so it doesn't also clear the selection
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      if (!wasCommitted) {
        useScene.getState().updateNode(nodeId, {
          position: originalPosition,
          rotation: [0, originalRotationRef.current, 0],
        })
      }
      // Drop the live transform — committed positions are now in the scene
      // store, so the floor-plan should read those instead of the stale
      // drag overlay.
      useLiveTransforms.getState().clear(nodeId)
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [exitMoveMode]) // stable — node values captured via refs at mount

  return (
    <group>
      <CursorSphere position={cursorWorldPos} showTooltip={false} />
    </group>
  )
}

export default MoveBuildingContent
