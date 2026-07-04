'use client'

import { useEffect } from 'react'
import { seedFixedFactoryLiveDataSource } from '../../../lib/fixed-live-data-source'

export function FixedLiveDataSource() {
  useEffect(() => {
    seedFixedFactoryLiveDataSource()
  }, [])

  return null
}
