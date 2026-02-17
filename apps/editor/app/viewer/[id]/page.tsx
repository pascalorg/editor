'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer } from '@pascal-app/viewer'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ViewerCameraControls } from './viewer-camera-controls'
import { ViewerOverlay } from './viewer-overlay'
import { ViewerZoneSystem } from './viewer-zone-system'
import { ThumbnailGenerator } from './thumbnail-generator'
import { getProjectModelPublic, incrementProjectViews } from '@/features/community/lib/projects/actions'

export default function ViewerPage() {
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
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
        } else {
          // Load from database (public project)
          const result = await getProjectModelPublic(id)

          if (result.success && result.data) {
            const { project, model } = result.data
            setProjectId(project.id)

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
      <ViewerOverlay />
      <Viewer>
        {/* Custom Camera Controls */}
        <ViewerCameraControls />
        {/* Custom Zone System */}
        <ViewerZoneSystem />
        {/* Thumbnail Generator */}
        <ThumbnailGenerator projectId={projectId || undefined} />
      </Viewer>
    </div>
  )
}
