'use client'

import { useEffect } from 'react'
import { initializeRockCutInvalidation } from './cut-invalidation'

const RockCutSystem = () => {
  useEffect(() => initializeRockCutInvalidation(), [])
  return null
}

export default RockCutSystem
