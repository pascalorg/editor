'use client'

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

export function CameraSetup() {
  const { camera } = useThree()
  
  useEffect(() => {
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera])
  
  return null
}

