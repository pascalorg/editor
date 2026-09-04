'use client'

import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useLiveTransforms, type UserPresence } from '@pascal-app/core'

interface RemoteGhostMeshProps {
  nodeId: string
  color: string
}

/**
 * Ephemeral ghost outline for a remote peer's active 3D drag.
 * Decoupled from React 19 re-renders by mutating the Three.js matrix directly in useFrame.
 */
export function RemoteGhostMesh({ nodeId, color }: RemoteGhostMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const targetPos = useRef(new THREE.Vector3())
  const targetEuler = useRef(new THREE.Euler())

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const activeTransform = useLiveTransforms.getState().get(nodeId)
    if (!activeTransform) {
      meshRef.current.visible = false
      return
    }

    meshRef.current.visible = true
    const [x, y, z] = activeTransform.position
    targetPos.current.set(x, y, z)
    targetEuler.current.set(0, activeTransform.rotation ?? 0, 0)

    // Smooth exponential decay LERP (30Hz -> 60/120Hz display refresh)
    const factor = 1 - Math.exp(-30 * delta)
    meshRef.current.position.lerp(targetPos.current, factor)
    meshRef.current.rotation.y += (targetEuler.current.y - meshRef.current.rotation.y) * factor
  })

  return (
    <mesh ref={meshRef} visible={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={color}
        wireframe
        transparent
        opacity={0.6}
      />
    </mesh>
  )
}

interface RemoteGhostLayerProps {
  presences: Map<number, UserPresence>
  localClientId: number | null
}

export function RemoteGhostLayer({ presences, localClientId }: RemoteGhostLayerProps) {
  const ghostItems = Array.from(presences.entries()).filter(
    ([clientId, presence]) =>
      clientId !== localClientId &&
      presence.activeDrag &&
      presence.activeDrag.nodeId,
  )

  return (
    <group name="multiplayer-ghost-layer">
      {ghostItems.map(([clientId, presence]) => (
        <RemoteGhostMesh
          key={clientId}
          nodeId={presence.activeDrag!.nodeId}
          color={presence.color}
        />
      ))}
    </group>
  )
}
