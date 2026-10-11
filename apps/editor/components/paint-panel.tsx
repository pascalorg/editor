'use client'

import { MaterialPaintPanel, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { activatePaintMode } from '@/lib/build-palette'

/**
 * Paint rail panel — the home for material painting, as in the community
 * editor. Painting lasts as long as the panel is open: mounting arms it,
 * leaving the panel drops back to select.
 */
export function PaintPanel() {
  useEffect(() => {
    activatePaintMode()
    return () => {
      const editor = useEditor.getState()
      if (editor.mode === 'material-paint') editor.setMode('select')
    }
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <MaterialPaintPanel />
    </div>
  )
}
