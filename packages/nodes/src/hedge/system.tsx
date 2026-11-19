'use client'

import { useEffect } from 'react'
import { initializeHedgeGroundInvalidation } from './ground-invalidation'

const HedgeGroundSystem = () => {
  useEffect(() => initializeHedgeGroundInvalidation(), [])
  return null
}

export default HedgeGroundSystem
