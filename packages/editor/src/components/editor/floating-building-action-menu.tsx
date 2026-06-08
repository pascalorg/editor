'use client'

import { type BuildingNode, sceneRegistry, useScene } from '@pascal-app/core'
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

  // 90° CW step. Pivots around the building's world bbox center, so the
  // building spins in place instead of orbiting its (often off-centre)
  // origin — same offset compensation `MoveBuildingContent` uses while
  // R/T-rotating during a drag.
  const handleRotate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!buildingId) return
      const node = useScene.getState().nodes[buildingId]
      if (!node || node.type !== 'building') return
      const building = node as BuildingNode
      const mesh = sceneRegistry.nodes.get(buildingId)
      if (!mesh) return
      const box = new THREE.Box3().setFromObject(mesh)
      if (box.isEmpty()) return

      const currentRotY = building.rotation[1] ?? 0
      const nextRotY = currentRotY - Math.PI / 2 // CW in three.js Y handedness

      const center = box.getCenter(new THREE.Vector3())
      const originWorld = new THREE.Vector3()
      mesh.getWorldPosition(originWorld)
      const Y_AXIS = new THREE.Vector3(0, 1, 0)
      const centerOffsetLocal = center
        .clone()
        .sub(originWorld)
        .applyAxisAngle(Y_AXIS, -currentRotY)
      const offAtNext = centerOffsetLocal.clone().applyAxisAngle(Y_AXIS, nextRotY)
      const nextPos: [number, number, number] = [
        center.x - offAtNext.x,
        building.position[1],
        center.z - offAtNext.z,
      ]

      sfxEmitter.emit('sfx:item-rotate')
      useScene.getState().updateNode(buildingId, {
        position: nextPos,
        rotation: [building.rotation[0], nextRotY, building.rotation[2]],
      })
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
          onRotate={handleRotate}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      </Html>
    </group>
  )
}
