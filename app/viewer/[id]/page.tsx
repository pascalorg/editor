'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import Viewer from '@/components/viewer'
import { ViewerControls } from '@/components/viewer/viewer-controls'
import { ViewerLayersMenu } from '@/components/viewer/viewer-layers-menu'
import { useEditor } from '@/hooks/use-editor'
import type { Scene } from '@/lib/scenegraph/schema/index'

export default function DynamicViewerPage() {
  const params = useParams()
  const id = params.id as string
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadLayout = useEditor((state) => state.loadLayout)

  // Handle hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // Load the demo layout from public/demos/<id>.json
  useEffect(() => {
    const loadDemo = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(`/demos/${id}.json`)

        if (!response.ok) {
          throw new Error(`Failed to load demo: ${response.statusText}`)
        }

        const data: Scene = await response.json()
        loadLayout(data)
        setIsLoading(false)
      } catch (err) {
        console.error('Error loading demo:', err)
        setError(err instanceof Error ? err.message : 'Failed to load demo')
        setIsLoading(false)
      }
    }

    if (id) {
      loadDemo()
    }
  }, [id, loadLayout])

  if (isLoading) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[#303035]">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-white/60">Loading demo...</p>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[#303035]">
        <div className="text-center">
          <p className="mb-2 text-lg text-red-400">Error loading demo</p>
          <p className="text-sm text-white/60">{error}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="relative h-screen w-screen">
      {/* Main Viewer */}
      <Viewer />

      {/* Viewer Controls */}
      <ViewerControls />

      {/* Floating Layers Menu */}
      <aside className="pointer-events-none fixed top-20 left-4 z-40 max-h-[calc(100vh-7rem)]">
        <div className="pointer-events-auto rounded-lg border border-white/10 bg-black/20 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/30">
          <ViewerLayersMenu mounted={mounted} />
        </div>
      </aside>
    </main>
  )
}
