'use client'

import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { getSocket } from '../../../../../apps/editor/lib/socket' // This is problematic for a shared package

// Instead of importing from apps/editor, we should probably pass the socket or use an event bus.
// For now, I'll define a way to inject the socket.

let globalSocket: any = null
export const setCollaborationSocket = (socket: any) => {
  globalSocket = socket
}

interface UserPresence {
  userId: string
  cursor: [number, number, number]
  name: string
  color: string
}

export function PresenceSystem({ projectId }: { projectId: string }) {
  const [presences, setPresences] = useState<Record<string, UserPresence>>({})

  useEffect(() => {
    if (!globalSocket) return

    const handlePresence = (data: any) => {
      if (data.projectId !== projectId) return
      setPresences(prev => ({
        ...prev,
        [data.userId]: data
      }))
    }

    globalSocket.on('presence', handlePresence)
    return () => {
      globalSocket.off('presence', handlePresence)
    }
  }, [projectId])

  return (
    <>
      {Object.values(presences).map((p) => (
        <group key={p.userId} position={p.cursor}>
          <Html distanceFactor={10}>
            <div className="flex flex-col items-center pointer-events-none">
              <div 
                className="w-3 h-3 rounded-full shadow-lg" 
                style={{ backgroundColor: p.color }} 
              />
              <span className="text-[10px] font-bold bg-black/80 text-white px-1.5 py-0.5 rounded-md mt-1 whitespace-nowrap">
                {p.name}
              </span>
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}
