'use client'

import { useEffect } from 'react'

// Local-only React tooling: react-scan (render highlighting + FPS toolbar)
// and react-grab (⌘C over an element copies its component stack for agents).
// The NODE_ENV guard is statically resolved, so production builds drop both
// dynamic imports entirely. Verified against the prod bundle.
export function DevTools() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      return
    }
    void import('react-scan').then(({ scan }) => {
      scan({ enabled: true, showToolbar: true })
    })
    void import('react-grab').then(({ init, isInstrumentationActive }) => {
      if (!isInstrumentationActive()) {
        init()
      }
    })
  }, [])

  return null
}
