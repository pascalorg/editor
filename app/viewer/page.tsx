'use client'

import { useEffect, useState } from 'react'
import Viewer from '@/components/viewer'
import { ViewerLayersMenu } from '@/components/viewer/viewer-layers-menu'

export default function ViewerPage() {
  const [mounted, setMounted] = useState(false)

  // Handle hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <main className="relative h-screen w-screen">
      {/* Main Viewer */}
      <Viewer />

      {/* Floating Layers Menu */}
      <aside className="pointer-events-none fixed top-20 left-4 z-40 max-h-[calc(100vh-7rem)]">
        <div className="pointer-events-auto rounded-lg border border-white/10 bg-black/20 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/30">
          <ViewerLayersMenu mounted={mounted} />
        </div>
      </aside>
    </main>
  )
}
