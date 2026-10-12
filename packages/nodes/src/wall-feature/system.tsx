'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { resetWallFeatureGeometry, syncWallFeatureGeometry } from './runtime'

export default function WallFeatureSystem() {
  useEffect(() => resetWallFeatureGeometry, [])
  useFrame(syncWallFeatureGeometry, 3)
  return null
}
