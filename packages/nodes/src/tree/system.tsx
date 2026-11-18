'use client'

import { useEffect } from 'react'
import { initializeTreeGroundInvalidation } from './ground-invalidation'

export default function TreeGroundSystem() {
  useEffect(() => initializeTreeGroundInvalidation(), [])
  return null
}
