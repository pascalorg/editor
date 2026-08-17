'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { Navigation } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CompassWidget() {
  const [rotationDeg, setRotationDeg] = useState(0)
  const viewMode = useEditor((state) => state.viewMode)
  const siteId = useScene((state) =>
    state.rootNodeIds.find((id) => state.nodes[id]?.type === 'site'),
  )
  const siteNode = useScene((state) => (siteId ? state.nodes[siteId] : undefined))
  // Default to 0 if not a site node or not present
  const northOffset = siteNode?.type === 'site' ? siteNode.northOffset : 0

  useEffect(() => {
    let frameId: number

    function update() {
      if (viewMode === '3d' || viewMode === 'split') {
        // In 3D, read the camera's azimuth.
        // The camera azimuth is 0 when looking from +Z to origin (plan-up is -Z).
        // Since the camera orbits around the target, an increasing azimuth (moving to +X)
        // makes the scene appear to rotate counter-clockwise on screen.
        // So the north arrow needs to rotate clockwise by the same amount to stay aligned.
        const controls = (window as any).__pascalCameraControls?.()
        let azimuthDeg = 0
        if (controls) {
          azimuthDeg = (controls.azimuthAngle * 180) / Math.PI
        }
        setRotationDeg(northOffset + azimuthDeg)
      } else {
        // In 2D, the view is always plan-up (-Z is up on screen).
        setRotationDeg(northOffset)
      }
      frameId = requestAnimationFrame(update)
    }

    frameId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frameId)
  }, [viewMode, northOffset])

  return (
    <div
      className="flex h-10 w-10 items-center justify-center text-muted-foreground pointer-events-none"
      title={`North Offset: ${northOffset}°`}
    >
      <div
        className="flex items-center justify-center text-red-500/80 dark:text-red-400/80"
        style={{
          transform: `rotate(${rotationDeg}deg)`,
          transition: viewMode === '2d' ? 'transform 0.3s ease' : 'none',
        }}
      >
        <Navigation className="h-4 w-4 fill-current" />
      </div>
    </div>
  )
}
