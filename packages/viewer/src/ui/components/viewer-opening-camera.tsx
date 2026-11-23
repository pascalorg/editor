'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import type { OpeningCameraPose } from '../lib/opening-camera'

type LookAtControls = {
  setLookAt: (
    px: number,
    py: number,
    pz: number,
    tx: number,
    ty: number,
    tz: number,
    enableTransition?: boolean,
  ) => unknown
}

export type ViewerOpeningCameraProps = {
  onApplied: () => void
  pose: OpeningCameraPose
  ready: boolean
}

/**
 * Puts the camera on the opening pose once the scene is on screen. Both
 * framing paths move the camera first (`ViewerCameraControls` to the site's
 * bookmark, `GlbScene` to the building), so the pose lands a frame after
 * readiness and without a transition: the last move is the one that sticks.
 */
export function ViewerOpeningCamera({ onApplied, pose, ready }: ViewerOpeningCameraProps) {
  const controls = useThree((state) => state.controls) as LookAtControls | null
  const camera = useThree((state) => state.camera)
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current || !(ready && controls)) return
    const frame = requestAnimationFrame(() => {
      applied.current = true
      const perspective = camera as PerspectiveCamera
      if (pose.fov !== undefined && perspective.isPerspectiveCamera) {
        perspective.fov = pose.fov
        perspective.updateProjectionMatrix()
      }
      const [px, py, pz] = pose.position
      const [tx, ty, tz] = pose.target
      controls.setLookAt(px, py, pz, tx, ty, tz, false)
      onApplied()
    })
    return () => cancelAnimationFrame(frame)
  }, [camera, controls, onApplied, pose, ready])

  return null
}
