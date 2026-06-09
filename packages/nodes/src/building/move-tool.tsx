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
  getBuildingLocalBboxCenter,
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
  // floating drag button anchors at the bbox center, so we pin that point to
  // the cursor during the drag — otherwise the raw origin (often nowhere near
  // the visual center) would snap to the cursor and the building would jump.
  const centerOffsetLocalRef = useRef<THREE.Vector3>(new THREE.Vector3())

  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>(() => {
    const obj = sceneRegistry.nodes.get(node.id)
    if (obj) {
      // Use the rotation-INVARIANT local bbox center, not the world AABB
      // center. Walk descendants and union their geometry bounds in the
      // building's local frame so the pivot point is the same regardless
      // of which rotation the building happens to be at right now.
      const localCenter = getBuildingLocalBboxCenter(obj)
      if (localCenter) {
        centerOffsetLocalRef.current.copy(localCenter)
        const originalRotation = node.rotation[1] ?? 0
        const cos = Math.cos(originalRotation)
        const sin = Math.sin(originalRotation)
        const originWorld = new THREE.Vector3()
        obj.getWorldPosition(originWorld)
        // World position of the local-centroid at the current rotation.
        const wx = originWorld.x + localCenter.x * cos + localCenter.z * sin
        const wz = originWorld.z - localCenter.x * sin + localCenter.z * cos
        return [wx, 0, wz]
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

    useScene.temporal.getState().pause()

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

      const ROTATION_STEP = Math.PI / 2
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        triggerSFX('sfx:item-rotate')
        const oldRotation = pendingRotationRef.current
        const newRotation = oldRotation + rotationDelta
        pendingRotationRef.current = newRotation

        const mesh = sceneRegistry.nodes.get(nodeId)
        if (mesh) {
          // Always pivot around the building's current world bbox center —
          // never around the origin. Capture the pivot from the mesh's
          // current pose (origin + offset rotated by the old rotation),
          // then re-anchor so that same world point stays fixed through
          // the rotation.
          const offOld = offsetAt(oldRotation)
          const pivotX = mesh.position.x + offOld.x
          const pivotZ = mesh.position.z + offOld.z
          const offNew = offsetAt(newRotation)
          mesh.rotation.y = newRotation
          mesh.position.x = pivotX - offNew.x
          mesh.position.z = pivotZ - offNew.z
          publishLive(mesh.position.x, mesh.position.z, newRotation)
        }
      }
    }

    const onGridMove = (event: GridEvent) => {
      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2

      if (
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
      wasCommitted = true

      // Commit the exact pose the mesh is showing right now. Recomputing
      // `gridX - off.x` from the click event would diverge from the last
      // `onGridMove`/`onKeyDown` write whenever the click event's cursor
      // position rounds to a different cell — visible snap on release.
      const mesh = sceneRegistry.nodes.get(nodeId)
      const finalPos: [number, number, number] = mesh
        ? [mesh.position.x, originalPosition[1], mesh.position.z]
        : [originalPosition[0], originalPosition[1], originalPosition[2]]

      useScene.temporal.getState().resume()
      useScene.getState().updateNode(nodeId, {
        position: finalPos,
        rotation: [0, pendingRotationRef.current, 0],
      })
      useScene.temporal.getState().pause()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ buildingId: nodeId as BuildingNode['id'] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
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
    }
  }, [exitMoveMode]) // stable — node values captured via refs at mount

  return (
    <group>
      <CursorSphere position={cursorWorldPos} showTooltip={false} />
    </group>
  )
}

export default MoveBuildingContent
