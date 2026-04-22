'use client'

import { useCallback } from 'react'
import { loadHomeScene } from './home-scene'

export function useHomeEditorOrchestration() {
  const handleLoad = useCallback(() => loadHomeScene(), [])

  return {
    handleLoad,
  }
}
