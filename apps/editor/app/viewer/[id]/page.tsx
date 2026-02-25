'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { useViewer, Viewer } from '@pascal-app/viewer'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  getProjectModelPublic,
  incrementProjectViews,
} from '@/features/community/lib/projects/actions'
import type { ProjectOwner } from '@/features/community/lib/projects/types'
import { ViewerCameraControls } from './viewer-camera-controls'
import { ViewerGuestCTA } from './viewer-guest-cta'
import { ViewerOverlay } from './viewer-overlay'
import { ViewerZoneSystem } from './viewer-zone-system'

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
    const loadContent = async () => {
      try {
        // Check if it's a demo file (starts with 'demo_')
        if (id.startsWith('demo_')) {
          const response = await fetch(`/demos/${id}.json`)
          if (!response.ok) {
            throw new Error(`Demo "${id}" not found`)
          }
          const data = await response.json()
          if (data.nodes && data.rootNodeIds) {
            setScene(data.nodes, data.rootNodeIds)
            initSpatialGridSync()
          }
          setProjectName('Demo')
        } else {
          // Load from database (public project)
          const result = await getProjectModelPublic(id)

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
          } else {
            throw new Error(result.error || 'Project not found')
          }
        }

        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load content')
        setLoading(false)
      }
    }

    loadContent()
  }, [id, setScene])

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-neutral-100">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-neutral-100">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-full">
      <ViewerOverlay
        projectName={projectName}
        owner={owner}
        canShowScans={canShowScans}
        canShowGuides={canShowGuides}
      />
      <ViewerGuestCTA />
      <Viewer>
        <ViewerCameraControls />
        <ViewerZoneSystem />
      </Viewer>
    </div>
  )
}
