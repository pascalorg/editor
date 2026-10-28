'use client'

import { FoundationViewPanel } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

/** A picked foundation outline shows the building's Foundation panel; closing it lets the outline go. */
export default function FoundationPanel() {
  const setSelection = useViewer((state) => state.setSelection)
  return <FoundationViewPanel onClose={() => setSelection({ selectedIds: [] })} />
}
