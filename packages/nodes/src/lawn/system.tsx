'use client'

import { SITE_GROUND_DEPENDENCY_TYPES } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { registerSiteGroundInvalidation } from '../shared/site-ground-invalidation'
import { updateLawnLOD } from './lod'
import { updateLawnStrokeChunks } from './stroke-chunks'

const LAWN_DEPENDENCY_TYPES = [...SITE_GROUND_DEPENDENCY_TYPES, 'planting'] as const

export default function LawnSceneSystem() {
  useEffect(() => registerSiteGroundInvalidation('lawn', LAWN_DEPENDENCY_TYPES), [])
  useFrame(({ scene, camera, size }) => {
    updateLawnStrokeChunks()
    updateLawnLOD(scene, camera, size.height)
  })
  return null
}
