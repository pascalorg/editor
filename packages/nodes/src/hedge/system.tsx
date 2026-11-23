'use client'

import { SITE_GROUND_DEPENDENCY_TYPES } from '@pascal-app/core'
import { useEffect } from 'react'
import { registerSiteGroundInvalidation } from '../shared/site-ground-invalidation'

const HedgeGroundSystem = () => {
  useEffect(() => registerSiteGroundInvalidation('hedge', SITE_GROUND_DEPENDENCY_TYPES), [])
  return null
}

export default HedgeGroundSystem
