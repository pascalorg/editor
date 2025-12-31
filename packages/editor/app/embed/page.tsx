'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
// Import node registrations to ensure all renderers are available
import '@/components/nodes'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import {Viewer, WallMode} from '@pascal-app/viewer'
import { useEditor,  waitForHydration } from '@/hooks/use-editor'

function ViewerContent() {
  const searchParams = useSearchParams()
  const sceneUrl = searchParams.get('sceneUrl')
  const defaultZoom = searchParams.get('zoom')
  const defaultWallMode = searchParams.get('wallMode')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load the scene from URL or fall back to local storage
  useEffect(() => {
    const loadScene = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Wait for store to hydrate first
        // This ensures we don't get into a race condition where hydration
        // overwrites the scene we just loaded, and populates the persisted scene cache
        await waitForHydration()

        // If no sceneUrl provided, use the scene from local storage (already hydrated)
        if (!sceneUrl) {
          setIsLoading(false)
          return
        }

        // Use proxy to avoid CORS issues with external URLs (e.g., Supabase storage)
        const proxyUrl = `/api/proxy-scene?url=${encodeURIComponent(sceneUrl)}`
        const response = await fetch(proxyUrl)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Failed to fetch scene: ${response.statusText}`)
        }
        const json = await response.json()

        // Load the scene transiently - this won't overwrite the editor's persisted state
        useEditor.getState().loadTransientScene(json, sceneUrl)
        // For embedded viewer: ensure we start with no floor selected (building overview mode)
        // This allows users to hover and click to select levels interactively
        useEditor.setState({
          selectedFloorId: null,
          selectedZoneId: null,
          selectedNodeIds: [],
          viewMode: 'full',
        })
        setIsLoading(false)
      } catch (err) {
        console.error('Error loading scene:', err)
        setError(err instanceof Error ? err.message : 'Failed to load scene')
        setIsLoading(false)
      }
    }

    loadScene()
  }, [sceneUrl])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <p className="text-white/60">Loading scene...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-center">
        <div>
          <p className="mb-2 text-lg text-red-400">Error loading scene</p>
          <p className="text-sm text-white/60">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <Viewer
      defaultWallMode={defaultWallMode as WallMode}
      defaultZoom={defaultZoom ? Number(defaultZoom) : undefined}
      isEmbedded
    />
  )
}

export default function EmbedPage() {
  return (
    <main className="h-screen w-screen bg-[#303035]">
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center text-white">Loading...</div>
          }
        >
          <ViewerContent />
        </Suspense>
      </ErrorBoundary>
    </main>
  )
}
