'use client'

import { useEffect, useState } from 'react'
import Viewer from '@/components/viewer'
import { RequestPanel } from '@/components/viewer/request-panel'
import { ViewerControls } from '@/components/viewer/viewer-controls'
import { ViewerLayersMenu } from '@/components/viewer/viewer-layers-menu'
import { ViewerViewsMenu } from '@/components/viewer/viewer-views-menu'
import { useEditor } from '@/hooks/use-editor'

export default function ViewerPage() {
  const [mounted, setMounted] = useState(false)

  // Handle hydration
  useEffect(() => {
    setMounted(true)
    useEditor.getState().setControlMode('select')
  }, [])

  return (
    <main className="relative h-screen w-screen">
      {/* Viewer Controls */}
      <ViewerControls />

      {/* Main Viewer */}
      <Viewer />

      {/* Floating Layers Menu */}
      <aside className="pointer-events-none fixed top-20 left-4 z-40 flex max-h-[calc(100vh-7rem)] flex-col gap-2">
        <div className="pointer-events-auto rounded-lg border border-white/10 bg-black/20 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/30">
          <ViewerLayersMenu mounted={mounted} />
        </div>
        <div className="pointer-events-auto rounded-lg border border-white/10 bg-black/20 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/30">
          <ViewerViewsMenu mounted={mounted} />
        </div>
      </aside>
    </main>
  )
}
