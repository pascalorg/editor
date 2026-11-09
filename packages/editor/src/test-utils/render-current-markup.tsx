import { spyOn } from 'bun:test'
import React, { type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** Server-renders `element` from the stores' current state, not the startup state a server render reads. */
export function renderCurrentMarkup(element: ReactElement): string {
  const useSyncExternalStore = React.useSyncExternalStore
  const serverSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
    (subscribe, getSnapshot) => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
  )
  try {
    return renderToStaticMarkup(element)
  } finally {
    serverSnapshot.mockRestore()
  }
}
