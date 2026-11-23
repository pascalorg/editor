'use client'

import { type CameraControlFrameEvent, emitter, useScene } from '@pascal-app/core'
import { CameraControls, type CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { type TapOptions, trackPointerGestures } from '../../lib/pointer-gesture'
import useViewer from '../../store/use-viewer'
import {
  type CameraMouseButtons,
  type CameraPointerAction,
  type CameraTouches,
  cameraBindings,
} from '../lib/camera-bindings'
import { frameViewerCamera } from '../lib/viewer-selection'
import { useViewerCameraNavigationSync } from './use-viewer-camera-navigation-sync'

export type { CameraPointerAction }

export type ViewerCameraControlsProps = {
  mouseButtons?: CameraMouseButtons
  /** One-finger dolly-pan pans; pinch dolly requires two or more touches. */
  touches?: CameraTouches
  limits?: {
    minDistance?: number
    maxDistance?: number
    minPolarAngle?: number
    maxPolarAngle?: number
  }
  smoothTime?: number
  /** Opt into matching down/up tap classification for live and baked selection. */
  tap?: TapOptions
  glbActive?: boolean
  /** A `?camera=` pose owns the opening view. */
  holdOpening?: boolean
}

export const ViewerCameraControls = ({
  glbActive = false,
  holdOpening = false,
  mouseButtons: mouseOverrides,
  touches: touchOverrides,
  limits,
  smoothTime,
  tap,
}: ViewerCameraControlsProps = {}) => {
  const controls = useRef<CameraControlsImpl>(null!)
  const keyState = useRef({ space: false }).current
  const site = useScene((s) => Object.values(s.nodes).find((node) => node.type === 'site'))
  const cameraMode = useViewer((s) => s.cameraMode)
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const firstLoad = useRef(true)
  const opened = useRef(false)
  const camera = useThree((state) => state.camera)
  const publishNavigationPose = useViewerCameraNavigationSync(controls)

  const canvas = useThree((state) => state.gl.domElement)
  const { mouseButtons, touches } = useMemo(
    () => cameraBindings(cameraMode === 'orthographic', mouseOverrides, touchOverrides),
    [cameraMode, mouseOverrides, touchOverrides],
  )
  const tapEnabled = tap !== undefined
  const maxTravelPx = tap?.maxTravelPx
  const maxDurationMs = tap?.maxDurationMs
  useEffect(() => {
    if (tapEnabled) return trackPointerGestures(canvas, { maxTravelPx, maxDurationMs })
  }, [canvas, tapEnabled, maxTravelPx, maxDurationMs])

  // The parametric scene opens on the site's saved view (the baked one frames
  // itself in `GlbScene`). After that only the navigation moves the camera.
  useEffect(() => {
    if (!controls.current || glbActive) return

    // A default pose first, unless an opening pose places the camera: the saved
    // view then animates from the pose instead of snapping to the default first.
    if (firstLoad.current) {
      firstLoad.current = false
      if (!holdOpening) controls.current.setLookAt(30, 30, 30, 0, 0, 0, false)
    }
    if (opened.current || !site) return
    opened.current = true
    if (holdOpening || !site.camera) return
    const { position, target } = site.camera
    requestAnimationFrame(() => {
      controls.current?.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true,
      )
    })
  }, [site, glbActive, holdOpening])

  // The bar, the floor list and the sidebar frame what they select.
  useEffect(() => {
    const onFrame = (event: CameraControlFrameEvent) => {
      const control = controls.current
      if (!control) return
      frameViewerCamera(control, camera, event)
    }
    emitter.on('camera-controls:frame', onFrame)
    return () => emitter.off('camera-controls:frame', onFrame)
  }, [camera])

  useEffect(() => {
    const handleTopView = () => {
      if (!controls.current) return

      const currentPolarAngle = controls.current.polarAngle

      // Toggle: if already near top view (< 0.1 radians ≈ 5.7°), go back to 45°
      // Otherwise, go to top view (0°)
      const targetAngle = currentPolarAngle < 0.1 ? Math.PI / 4 : 0

      controls.current.rotatePolarTo(targetAngle, true)
    }

    const handleOrbitCW = () => {
      if (!controls.current) return

      const currentAzimuth = controls.current.azimuthAngle
      const currentPolar = controls.current.polarAngle
      // Round to nearest 90° increment, then rotate 90° clockwise
      const rounded = Math.round(currentAzimuth / (Math.PI / 2)) * (Math.PI / 2)
      const target = rounded - Math.PI / 2

      controls.current.rotateTo(target, currentPolar, true)
    }

    const handleOrbitCCW = () => {
      if (!controls.current) return

      const currentAzimuth = controls.current.azimuthAngle
      const currentPolar = controls.current.polarAngle
      // Round to nearest 90° increment, then rotate 90° counter-clockwise
      const rounded = Math.round(currentAzimuth / (Math.PI / 2)) * (Math.PI / 2)
      const target = rounded + Math.PI / 2

      controls.current.rotateTo(target, currentPolar, true)
    }

    emitter.on('camera-controls:top-view', handleTopView)
    emitter.on('camera-controls:orbit-cw', handleOrbitCW)
    emitter.on('camera-controls:orbit-ccw', handleOrbitCCW)

    return () => {
      emitter.off('camera-controls:top-view', handleTopView)
      emitter.off('camera-controls:orbit-cw', handleOrbitCW)
      emitter.off('camera-controls:orbit-ccw', handleOrbitCCW)
    }
  }, [])

  useEffect(() => {
    const updateConfig = () => {
      if (!controls.current) return

      Object.assign(
        controls.current.mouseButtons,
        cameraBindings(
          cameraMode === 'orthographic',
          mouseOverrides,
          touchOverrides,
          keyState.space,
        ).mouseButtons,
      )
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      keyState.space = true
      document.body.style.cursor = 'grab'
      updateConfig()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      keyState.space = false
      document.body.style.cursor = ''
      updateConfig()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    updateConfig()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      if (document.body.style.cursor === 'grab') {
        document.body.style.cursor = ''
      }
    }
  }, [cameraMode, mouseOverrides, touchOverrides, keyState])

  const onTransitionStart = useCallback(() => {
    useViewer.getState().setCameraDragging(true)
  }, [])

  const onRest = useCallback(() => {
    useViewer.getState().setCameraDragging(false)
  }, [])

  if (walkthroughMode) {
    return null
  }

  return (
    <CameraControls
      makeDefault
      maxDistance={limits?.maxDistance ?? 100}
      maxPolarAngle={limits?.maxPolarAngle ?? Math.PI / 2 - 0.1}
      minDistance={limits?.minDistance ?? 5}
      minPolarAngle={limits?.minPolarAngle ?? 0}
      mouseButtons={mouseButtons}
      onRest={onRest}
      onSleep={onRest}
      onTransitionStart={onTransitionStart}
      onUpdate={publishNavigationPose}
      ref={controls}
      restThreshold={0.01}
      smoothTime={smoothTime ?? 0.25}
      touches={touches}
    />
  )
}
