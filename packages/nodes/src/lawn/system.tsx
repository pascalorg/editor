'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { initializeLawnSceneInvalidation } from './ground-invalidation'
import { updateLawnLOD } from './lod'

export default function LawnSceneSystem() {
  useEffect(() => initializeLawnSceneInvalidation(), [])
  useFrame(({ scene, camera, size }) => {
    updateLawnLOD(scene, camera, size.height)
  })
  return null
}
