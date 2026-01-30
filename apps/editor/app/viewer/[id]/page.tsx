'use client'

import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer } from '@pascal-app/viewer'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ViewerCameraControls } from './viewer-camera-controls'
import { ViewerOverlay } from './viewer-overlay'
import { ViewerZoneSystem } from './viewer-zone-system'

export default function ViewerPage() {
  const params = useParams()
  const id = params.id as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const setScene = useScene((state) => state.setScene)

  useEffect(() => {
    const loadDemo = async () => {
      try {
        const response = await fetch(`/demos/${id}.json`)
        if (!response.ok) {
          throw new Error(`Demo "${id}" not found`)
        }
        const data = await response.json()
        if (data.nodes && data.rootNodeIds) {
          setScene(data.nodes, data.rootNodeIds)
          initSpatialGridSync()
        }
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load demo')
        setLoading(false)
      }
    }

    loadDemo()
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
      </Viewer>
    </div>
  )
}
