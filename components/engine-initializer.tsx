'use client'

import { useEffect, useRef } from 'react'
import { initializeEngine, isEngineInitialized } from '@/lib/engine/init'

/**
 * Client-side engine initializer
 * Call this once in your app to register all built-in elements
 */
export function EngineInitializer() {
  const initialized = useRef(false)

  useEffect(() => {
    if (!(initialized.current || isEngineInitialized())) {
      console.log('[Engine] Initializing ECS engine...')
      initializeEngine()
      initialized.current = true
      console.log('[Engine] ✓ Initialized successfully')
    }
  }, [])

  return null
}
