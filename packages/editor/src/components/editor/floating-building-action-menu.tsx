'use client'

import {
  type BuildingNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useRef } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from './node-action-menu'

export function FloatingBuildingActionMenu() {
  const buildingId = useViewer((s) => s.selection.buildingId)
  const levelId = useViewer((s) => s.selection.levelId)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setSelection = useViewer((s) => s.setSelection)

  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!(buildingId && !levelId && groupRef.current)) return

    const obj = sceneRegistry.nodes.get(buildingId)
    if (obj) {
      const box = new THREE.Box3().setFromObject(obj)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        groupRef.current.position.set(center.x, 1.5, center.z)
      }
    }
  })

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!buildingId) return
      // Read lazily at click time — no need to subscribe to nodes for a
      // one-shot action.
      const node = useScene.getState().nodes[buildingId]
      if (!node || node.type !== 'building') return
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node as BuildingNode)
      setSelection({ buildingId: null })
    },
    [buildingId, setMovingNode, setSelection],
  )

  // Hold the rotate button and drag in a circle around the building to
  // spin it. The button's screen-space center is the pivot — cursor angle
  // around it maps directly to a world Y rotation (the button sits over
  // the building's bbox center, so the two pivots coincide). Position is
  // compensated each frame so the bbox center stays put while the origin
  // moves under rotation — same offset math `MoveBuildingContent` uses
  // for R/T mid-drag rotation. Shift snaps to 15°.
  const handleRotatePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!buildingId) return
      const initialNode = useScene.getState().nodes[buildingId] as BuildingNode | undefined
      if (!initialNode || initialNode.type !== 'building') return
      const mesh = sceneRegistry.nodes.get(buildingId)
      if (!mesh) return
      const box = new THREE.Box3().setFromObject(mesh)
      if (box.isEmpty()) return

      const initialPosition: [number, number, number] = [
        initialNode.position[0],
        initialNode.position[1],
        initialNode.position[2],
      ]
      const initialRotY = initialNode.rotation[1] ?? 0
      const center = box.getCenter(new THREE.Vector3())
      const originWorld = new THREE.Vector3()
      mesh.getWorldPosition(originWorld)
      const Y_AXIS = new THREE.Vector3(0, 1, 0)
      const centerOffsetLocal = center
        .clone()
        .sub(originWorld)
        .applyAxisAngle(Y_AXIS, -initialRotY)

      const buttonRect = e.currentTarget.getBoundingClientRect()
      const pivotScreenX = buttonRect.left + buttonRect.width / 2
      const pivotScreenY = buttonRect.top + buttonRect.height / 2
      const initialAngle = Math.atan2(e.clientY - pivotScreenY, e.clientX - pivotScreenX)
      const SNAP = Math.PI / 12 // 15°

      document.body.style.cursor = 'grabbing'
      sfxEmitter.emit('sfx:item-pick')
      useViewer.getState().setInputDragging(true)
      useScene.temporal.getState().pause()

      let pendingRotY = initialRotY
      let pendingPos: [number, number, number] = initialPosition
      const offsetWork = new THREE.Vector3()

      const applyPose = (newRotY: number) => {
        const off = offsetWork.copy(centerOffsetLocal).applyAxisAngle(Y_AXIS, newRotY)
        pendingPos = [center.x - off.x, initialPosition[1], center.z - off.z]
        pendingRotY = newRotY
        mesh.position.x = pendingPos[0]
        mesh.position.z = pendingPos[2]
        mesh.rotation.y = newRotY
        useLiveTransforms.getState().set(buildingId, {
          position: pendingPos,
          rotation: newRotY,
        })
      }

      const onMove = (ev: PointerEvent) => {
        const angle = Math.atan2(ev.clientY - pivotScreenY, ev.clientX - pivotScreenX)
        let delta = angle - initialAngle
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
        if (ev.shiftKey) delta = Math.round(delta / SNAP) * SNAP
        // Screen-space CW (atan2 positive delta) maps to world-space CW
        // around +Y from above, which is rotY decreasing in three.js's
        // right-handed Y rotation — so subtract.
        applyPose(initialRotY - delta)
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
        useScene.temporal.getState().resume()
        useViewer.getState().setInputDragging(false)
        useLiveTransforms.getState().clear(buildingId)
      }

      const onUp = () => {
        sfxEmitter.emit('sfx:item-place')
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(buildingId, {
          position: pendingPos,
          rotation: [initialNode.rotation[0], pendingRotY, initialNode.rotation[2]],
        })
        cleanup()
      }

      const onCancel = () => {
        mesh.position.set(initialPosition[0], initialPosition[1], initialPosition[2])
        mesh.rotation.y = initialRotY
        cleanup()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    },
    [buildingId],
  )

  // Only show when a building is selected without a level
  if (!buildingId || levelId) return null

  return (
    <group ref={groupRef}>
      <Html
        center
        style={{
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
        zIndexRange={[25, 0]}
      >
        <NodeActionMenu
          onMove={handleMove}
          onRotatePointerDown={handleRotatePointerDown}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      </Html>
    </group>
  )
}
