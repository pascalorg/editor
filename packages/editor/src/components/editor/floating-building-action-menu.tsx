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
        zIndexRange={[100, 0]}
      >
        <NodeActionMenu
          onMove={handleMove}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      </Html>
    </group>
  )
}
