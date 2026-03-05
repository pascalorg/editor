'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { useViewer, Viewer } from '@pascal-app/viewer'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ErrorBoundary } from '@/components/ui/primitives/error-boundary'
import { SceneLoader } from '@/components/ui/scene-loader'
import {
  getProjectModelPublic,
  incrementProjectViews,
} from '@/features/community/lib/projects/actions'
import type { ProjectOwner } from '@/features/community/lib/projects/types'
import { ViewerCameraControls } from './viewer-camera-controls'
import { ViewerGuestCTA } from './viewer-guest-cta'
import { ViewerOverlay } from './viewer-overlay'
import { ViewerZoneSystem } from './viewer-zone-system'

function ViewerSceneCrashFallback({ projectName }: { projectName?: string | null }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/95 p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold">The 3D scene failed to render</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {projectName ? `"${projectName}" ` : ''}
          hit a rendering error. The rest of the app is still available.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="rounded-md border border-border bg-accent px-3 py-2 text-sm font-medium hover:bg-accent/80"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload scene
          </button>
          <Link
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent/40"
            href="/"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ViewerPage() {
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [owner, setOwner] = useState<ProjectOwner | null>(null)
  const [canShowScans, setCanShowScans] = useState(true)
  const [canShowGuides, setCanShowGuides] = useState(true)
  const setScene = useScene((state) => state.setScene)

  useEffect(() => {
    useViewer.getState().setProjectId(projectId)
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setProjectId(null)
    setProjectName(null)
    setOwner(null)
    setCanShowScans(true)
    setCanShowGuides(true)
    useViewer.getState().setShowScans(true)
    useViewer.getState().setShowGuides(true)

    const loadContent = async () => {
      try {
        // Check if it's a demo file (starts with 'demo_')
        if (id.startsWith('demo_')) {
          const response = await fetch(`/demos/${id}.json`)
          if (cancelled) return

          if (!response.ok) {
            throw new Error(`Demo "${id}" not found`)
          }

          const data = await response.json()
          if (cancelled) return

          if (data.nodes && data.rootNodeIds) {
            setScene(data.nodes, data.rootNodeIds)
            initSpatialGridSync()
          }

          setProjectName('Demo')
        } else {
          // Load from database (public project)
          const result = await getProjectModelPublic(id)
          if (cancelled) return

          if (result.success && result.data) {
            const { project, model, isOwner } = result.data
            const projectData = project as any

            setProjectId(project.id)
            setProjectName(project.name)
            setOwner(projectData.owner ?? null)

            // Apply public visibility settings for scans/guides (only for non-owners)
            if (!isOwner) {
              const scansAllowed = projectData.show_scans_public !== false
              const guidesAllowed = projectData.show_guides_public !== false
              setCanShowScans(scansAllowed)
              setCanShowGuides(guidesAllowed)

              if (!scansAllowed) {
                useViewer.getState().setShowScans(false)
              }
              if (!guidesAllowed) {
                useViewer.getState().setShowGuides(false)
              }
            }

            if (model?.scene_graph) {
              const { nodes, rootNodeIds } = model.scene_graph
              setScene(nodes, rootNodeIds)
              initSpatialGridSync()
            }

            // Increment view count
            await incrementProjectViews(id)
            if (cancelled) return
          } else {
            throw new Error(result.error || 'Project not found')
          }
        }

        if (!cancelled) {
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load content')
          setLoading(false)
        }
      }
    }

    loadContent()

    return () => {
      cancelled = true
    }
  }, [id, setScene])

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-neutral-100">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-full">
      {loading && <SceneLoader fullScreen />}

      {!loading && (
        <>
          <ViewerOverlay
            projectName={projectName}
            owner={owner}
            canShowScans={canShowScans}
            canShowGuides={canShowGuides}
          />
          <ViewerGuestCTA />

          <ErrorBoundary key={id} fallback={<ViewerSceneCrashFallback projectName={projectName} />}>
            <Viewer>
              <ViewerCameraControls />
              <ViewerZoneSystem />
            </Viewer>
          </ErrorBoundary>
        </>
      )}
    </div>
  )
}
