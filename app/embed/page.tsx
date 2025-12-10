'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
// Import node registrations to ensure all renderers are available
import '@/components/nodes'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import EmbeddedViewer from '@/components/viewer/embedded-viewer'
import { useEditor, waitForHydration } from '@/hooks/use-editor'

function ViewerContent() {
  const searchParams = useSearchParams()
  const sceneUrl = searchParams.get('sceneUrl')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load the scene from URL
  useEffect(() => {
    const loadScene = async () => {
      if (!sceneUrl) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        // Wait for store to hydrate first, then load our scene
        // This ensures we don't get into a race condition where hydration
        // overwrites the scene we just loaded
        await waitForHydration()

        // Use proxy to avoid CORS issues with external URLs (e.g., Supabase storage)
        const proxyUrl = `/api/proxy-scene?url=${encodeURIComponent(sceneUrl)}`
        const response = await fetch(proxyUrl)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Failed to fetch scene: ${response.statusText}`)
        }
        const json = await response.json()

        // Load the scene into the store
        // This will overwrite any hydrated state with our scene
        useEditor.getState().loadLayout(json)
        // For embedded viewer: ensure we start with no floor selected (building overview mode)
        // This allows users to hover and click to select levels interactively
        // Need to use setState directly since loadLayout might leave floor selected from previous state
        useEditor.setState({
          selectedFloorId: null,
          selectedCollectionId: null,
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

  if (!sceneUrl) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        No scene URL provided
      </div>
    )
  }

  return <EmbeddedViewer />
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
