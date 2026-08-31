'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import useEditor from '../../store/use-editor'

/**
 * Owns the main camera's field of view while the snapshot capture overlay is
 * open, and is mounted only for that window. `ThumbnailGenerator` copies the
 * main camera's fov on every shot, so the value written here is what lands in
 * the saved image.
 *
 * The overlay's slider cannot reach the camera itself (it renders outside the
 * canvas), so the store carries the value and this rig applies it.
 */
export const CaptureCameraRig = () => {
  const camera = useThree((state) => state.camera)
  const captureFov = useEditor((state) => state.captureFov)
  const appliedFovRef = useRef<number | null>(null)

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera
    if (!perspectiveCamera.isPerspectiveCamera) {
      // Orthographic captures have no fov to drive — the overlay hides the
      // control while the store is disarmed.
      useEditor.getState().armCaptureFov(null)
      return
    }

    const entryFov = perspectiveCamera.fov
    useEditor.getState().armCaptureFov(entryFov)

    return () => {
      useEditor.getState().armCaptureFov(null)
      // Walkthrough restores its own pre-entry fov when it unmounts, which can
      // happen in the same commit as this rig (leaving capture also leaves
      // walk/drone). Only put the entry fov back if the camera still holds our
      // last write — otherwise someone else has already re-owned it.
      if (appliedFovRef.current !== null && perspectiveCamera.fov === appliedFovRef.current) {
        perspectiveCamera.fov = entryFov
        perspectiveCamera.updateProjectionMatrix()
      }
      appliedFovRef.current = null
    }
  }, [camera])

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera
    if (!perspectiveCamera.isPerspectiveCamera || captureFov === null) return

    appliedFovRef.current = captureFov
    if (perspectiveCamera.fov === captureFov) return
    perspectiveCamera.fov = captureFov
    perspectiveCamera.updateProjectionMatrix()
  }, [camera, captureFov])

  return null
}
