'use client'

import { SITE_GROUND_DEPENDENCY_TYPES } from '@pascal-app/core'
import { useEffect } from 'react'
import { registerSiteGroundInvalidation } from '../shared/site-ground-invalidation'

export default function TreeGroundSystem() {
  useEffect(() => registerSiteGroundInvalidation('tree', SITE_GROUND_DEPENDENCY_TYPES), [])
  return null
}
