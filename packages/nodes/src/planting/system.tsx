'use client'

import { useEffect } from 'react'
import { initializePlantingSceneInvalidation } from './ground-invalidation'

export default function PlantingSceneSystem() {
  useEffect(() => initializePlantingSceneInvalidation(), [])
  return null
}
