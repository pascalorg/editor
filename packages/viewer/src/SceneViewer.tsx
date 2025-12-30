'use client'

import { useEffect, useState } from 'react'
import { useEditor, waitForHydration, type WallMode } from '@pascal/core/hooks'
import { Viewer } from './components'

// Import node registrations to ensure all renderers are available
import '@pascal/core/components/nodes'

export interface SceneViewerProps {
  /** URL to load the scene JSON from */
  sceneUrl?: string
  /** Initial zoom level for orthographic camera (default: 80) */
  defaultZoom?: number
  /** When true, posts selection changes to parent window for iframe embedding */
  isEmbedded?: boolean
  /** Initial wall mode for viewer */
  defaultWallMode?: WallMode
  /** CSS class name for the container */
  className?: string
  /** Custom loading component */
  loadingComponent?: React.ReactNode
  /** Custom error component */
  errorComponent?: (error: string) => React.ReactNode
  /** Callback when scene is loaded */
  onSceneLoaded?: () => void
  /** Callback when an error occurs */
  onError?: (error: string) => void
  /** Callback when selection changes */
  onSelectionChange?: (selection: {
    selectedNodeIds: string[]
    selectedFloorId: string | null
    selectedZoneId: string | null
  }) => void
}

/**
 * SceneViewer - A standalone React component for viewing Pascal scenes.
 *
 * This component handles scene loading from URLs and provides a complete
 * 3D viewer with loading/error states.
 *
 * @example
 * ```tsx
 * import { SceneViewer } from '@pascal/viewer'
 *
 * function App() {
 *   return (
 *     <SceneViewer
 *       sceneUrl="https://example.com/scene.json"
 *       defaultZoom={80}
 *       onSelectionChange={(selection) => console.log(selection)}
 *     />
 *   )
 * }
 * ```
 */
export function SceneViewer({
  sceneUrl,
  defaultZoom = 80,
  isEmbedded = false,
  defaultWallMode = 'cutaway',
  className,
  loadingComponent,
  errorComponent,
  onSceneLoaded,
  onError,
  onSelectionChange,
}: SceneViewerProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Subscribe to selection changes
  useEffect(() => {
    if (!onSelectionChange) return

    const unsubscribe = useEditor.subscribe((state) => {
      onSelectionChange({
        selectedNodeIds: state.selectedNodeIds as string[],
        selectedFloorId: state.selectedFloorId,
        selectedZoneId: state.selectedZoneId,
      })
    })

    return unsubscribe
  }, [onSelectionChange])

  // Load scene from URL
  useEffect(() => {
    const loadScene = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Wait for store to hydrate first
        await waitForHydration()

        // If no sceneUrl provided, use the scene from local storage (already hydrated)
        if (!sceneUrl) {
          setIsLoading(false)
          onSceneLoaded?.()
          return
        }

        const response = await fetch(sceneUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch scene: ${response.statusText}`)
        }
        const json = await response.json()

        // Load the scene transiently
        useEditor.getState().loadTransientScene(json, sceneUrl)

        // Reset to initial state
        useEditor.setState({
          selectedFloorId: null,
          selectedZoneId: null,
          selectedNodeIds: [],
          viewMode: 'full',
          wallMode: defaultWallMode,
        })

        setIsLoading(false)
        onSceneLoaded?.()
      } catch (err) {
        console.error('Error loading scene:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to load scene'
        setError(errorMessage)
        setIsLoading(false)
        onError?.(errorMessage)
      }
    }

    loadScene()
  }, [sceneUrl, defaultWallMode, onSceneLoaded, onError])

  if (isLoading) {
    return (
      loadingComponent || (
        <div
          className={className}
          style={{
            display: 'flex',
            height: '100%',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#303035',
            color: 'white',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 48,
                height: 48,
                border: '4px solid rgba(255,255,255,0.2)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px',
              }}
            />
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>Loading scene...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        </div>
      )
    )
  }

  if (error) {
    return (
      errorComponent?.(error) || (
        <div
          className={className}
          style={{
            display: 'flex',
            height: '100%',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#303035',
            color: 'white',
            textAlign: 'center',
          }}
        >
          <div>
            <p style={{ color: '#f87171', fontSize: 18, marginBottom: 8 }}>Error loading scene</p>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>{error}</p>
          </div>
        </div>
      )
    )
  }

  return (
    <Viewer
      className={className}
      defaultWallMode={defaultWallMode}
      defaultZoom={defaultZoom}
      isEmbedded={isEmbedded}
    />
  )
}
