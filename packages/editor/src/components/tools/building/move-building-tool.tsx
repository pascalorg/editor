'use client'

import {
  type BuildingNode,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

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

  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>(() => {
    const obj = sceneRegistry.nodes.get(node.id)
    if (obj) {
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

    useScene.temporal.getState().pause()

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
        sfxEmitter.emit('sfx:item-rotate')
        pendingRotationRef.current += rotationDelta

        const mesh = sceneRegistry.nodes.get(nodeId)
        if (mesh) mesh.rotation.y = pendingRotationRef.current
      }
    }

    const onGridMove = (event: GridEvent) => {
      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2

      if (
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
      setCursorWorldPos([gridX, 0, gridZ])

      // Directly update the Three.js group — no store update during drag
      const mesh = sceneRegistry.nodes.get(nodeId)
      if (mesh) {
        mesh.position.x = gridX
        mesh.position.z = gridZ
      }
    }

    const onGridClick = (event: GridEvent) => {
      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2

      wasCommitted = true

      useScene.temporal.getState().resume()
      useScene.getState().updateNode(nodeId, {
        position: [gridX, originalPosition[1], gridZ],
        rotation: [0, pendingRotationRef.current, 0],
      })
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
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
