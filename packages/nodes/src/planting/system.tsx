'use client'

import { PLANTING_SCENE_DEPENDENCY_TYPES } from '@pascal-app/core'
import { useEffect } from 'react'
import { registerSiteGroundInvalidation } from '../shared/site-ground-invalidation'

export default function PlantingSceneSystem() {
  useEffect(() => registerSiteGroundInvalidation('planting', PLANTING_SCENE_DEPENDENCY_TYPES), [])
  return null
}
