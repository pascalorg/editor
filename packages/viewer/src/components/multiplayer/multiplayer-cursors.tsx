'use client'

import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { UserPresence } from '@pascal-app/core'

interface MultiplayerCursorsProps {
  presences: Map<number, UserPresence>
  localClientId: number | null
}

export function MultiplayerCursors({ presences, localClientId }: MultiplayerCursorsProps) {
  return (
    <group name="multiplayer-cursors-layer">
      {Array.from(presences.entries()).map(([clientId, presence]) => {
        if (clientId === localClientId || !presence.cursor?.worldPosition) {
          return null
        }
        return (
          <RemoteCursorItem
            key={clientId}
            presence={presence}
          />
        )
      })}
    </group>
  )
}

function RemoteCursorItem({ presence }: { presence: UserPresence }) {
  const groupRef = useRef<THREE.Group>(null)
  const targetPos = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    if (!groupRef.current || !presence.cursor?.worldPosition) return
    const [x, y, z] = presence.cursor.worldPosition
    targetPos.current.set(x, y, z)

    // Smooth exponential decay LERP
    groupRef.current.position.lerp(targetPos.current, 1 - Math.exp(-25 * delta))
  })

  const [x, y, z] = presence.cursor?.worldPosition ?? [0, 0, 0]

  return (
    <group ref={groupRef} position={[x, y, z]}>
      {/* 3D Pointer Cone */}
      <mesh rotation={[0, 0, Math.PI]} position={[0, 0.25, 0]}>
        <coneGeometry args={[0.12, 0.35, 16]} />
        <meshStandardMaterial
          color={presence.color}
          roughness={0.2}
          metalness={0.1}
          emissive={presence.color}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Billboard Name Tag */}
      <Html
        position={[0, 0.6, 0]}
        center
        distanceFactor={15}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold text-white shadow-lg whitespace-nowrap"
          style={{ backgroundColor: presence.color }}
        >
          <span>{presence.name}</span>
        </div>
      </Html>
    </group>
  )
}
