'use client'

import { useEffect, useState, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useCollaboration } from './YjsCollaborationProvider'

interface RemoteUser {
  clientId: number
  userId: string
  name: string
  color: string
  cursor: [number, number, number]
}

export function PresenceSystem() {
  const { awareness } = useCollaboration()
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([])
  const { camera, mouse, raycaster, scene } = useThree()
  const lastUpdateRef = useRef(0)

  // 1. Update local cursor position in Awareness
  useFrame((state) => {
    const now = Date.now()
    if (now - lastUpdateRef.current < 50) return // Throttle to 20fps
    lastUpdateRef.current = now

    // Raycast to find the 3D position on the ground plane (y=0)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const intersection = new THREE.Vector3()
    raycaster.setFromCamera(mouse, camera)
    
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      const user = awareness.getLocalState()?.user
      if (user) {
        awareness.setLocalStateField('user', {
          ...user,
          cursor: [intersection.x, intersection.y, intersection.z]
        })
      }
    }
  })

  // 2. Sync remote users from Awareness
  useEffect(() => {
    const handleUpdate = () => {
      const states = Array.from(awareness.getStates().entries())
        .filter(([clientId]) => clientId !== awareness.clientID)
        .map(([clientId, state]) => ({
          clientId,
          ...(state.user as Omit<RemoteUser, 'clientId'>)
        }))
        .filter(u => u.userId) as RemoteUser[]
      
      setRemoteUsers(states)
    }

    awareness.on('change', handleUpdate)
    handleUpdate()
    return () => {
      awareness.off('change', handleUpdate)
    }
  }, [awareness])

  return (
    <>
      {remoteUsers.map((user) => (
        <group key={user.clientId} position={user.cursor}>
          <Html distanceFactor={15} pointerEvents="none" zIndexRange={[0, 10]}>
            <div className="flex flex-col items-center select-none animate-in fade-in zoom-in duration-300">
              {/* Animated Cursor Ring */}
              <div className="relative flex items-center justify-center">
                <div 
                  className="absolute w-5 h-5 rounded-full opacity-40 animate-ping" 
                  style={{ backgroundColor: user.color }} 
                />
                <div 
                  className="w-3 h-3 rounded-full border-2 border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] z-10" 
                  style={{ backgroundColor: user.color }} 
                />
              </div>
              
              {/* Premium Name Badge */}
              <div 
                className="mt-2 px-2.5 py-1 rounded-lg text-[11px] font-bold text-white whitespace-nowrap shadow-2xl backdrop-blur-md border border-white/20 transition-all flex items-center gap-1.5"
                style={{ 
                  backgroundColor: `${user.color}dd`,
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span>{user.name}</span>
              </div>
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}
