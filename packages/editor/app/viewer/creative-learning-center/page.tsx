'use client'

import type { Scene } from '@pascal/core/scenegraph/schema'
import { useEffect, useState } from 'react'
import Viewer from '@/components/viewer'
import { RequestPanel } from '@/components/viewer/request-panel'
import { UserMenu } from '@/components/viewer/user-menu'
import { ViewerLayersMenu } from '@/components/viewer/viewer-layers-menu'
import { useEditor, waitForHydration } from '@/hooks/use-editor'

export default function ViewerPage() {
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Handle hydration
  useEffect(() => {
    setMounted(true)
    useEditor.getState().setControlMode('select')
  }, [])

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

        // Wait for Zustand persist hydration to complete first
        // Otherwise the loaded layout will be overwritten by rehydration
        await waitForHydration()
        console.log('[ViewerPage] Hydration complete, loading demo...')

        const response = await fetch('/demos/creative-learning-center.json')

        if (!response.ok) {
          throw new Error(`Failed to load demo: ${response.statusText}`)
        }

        const data: Scene = await response.json()
        loadLayout(data)
        setIsLoading(false)
        console.log('[ViewerPage] Demo loaded successfully')
      } catch (err) {
        console.error('Error loading demo:', err)
        setError(err instanceof Error ? err.message : 'Failed to load demo')
        setIsLoading(false)
      }
    }
    loadDemo()
  }, [loadLayout])

  if (isLoading) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[#303035]">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-white/60">Loading Creative Learning Center...</p>
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

      {/* Floating Request Panel */}
      <RequestPanel />

      {/* User Menu - Top Right */}
      <div className="fixed top-4 right-4 z-50">
        <UserMenu />
      </div>

      {/* Layers Menu - Left side */}
      <div className="fixed top-4 left-4 z-50 rounded-lg border border-gray-800 bg-[#1b1c1f]/90 shadow-lg backdrop-blur-sm">
        <div className="border-white/10 border-b px-3 py-2">
          <span className="font-medium text-sm text-white">Layers</span>
        </div>
        <ViewerLayersMenu mounted={mounted} />
      </div>
    </main>
  )
}
