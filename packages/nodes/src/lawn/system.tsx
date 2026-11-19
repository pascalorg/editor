'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { initializeLawnSceneInvalidation } from './ground-invalidation'
import { updateLawnLOD } from './lod'
import { updateLawnStrokeChunks } from './stroke-chunks'

export default function LawnSceneSystem() {
  useEffect(() => initializeLawnSceneInvalidation(), [])
  useFrame(({ scene, camera, size }) => {
    updateLawnStrokeChunks()
    updateLawnLOD(scene, camera, size.height)
  })
  return null
}
