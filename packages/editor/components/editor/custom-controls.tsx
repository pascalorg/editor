'use client'

import {
  emitter,
  type NodeCameraCaptureRequest,
  type ViewApplyEvent,
  type ViewCaptureRequest,
} from '@pascal/core/events'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { useEditor } from '@/hooks/use-editor'
import { FLOOR_SPACING, WALL_HEIGHT } from './index'

export function CustomControls() {
  const controlMode = useEditor((state) => state.controlMode)
  const cameraMode = useEditor((state) => state.cameraMode)
  const controls = useThree((state) => state.controls)
  const controlsRef = useRef<CameraControlsImpl>(null)
  const currentLevel = useEditor((state) => state.currentLevel)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)
  const debug = useEditor((state) => state.debug)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)

  useEffect(() => {
    if (!controls) return

    ;(controls as CameraControlsImpl).setLookAt(30, 30, 30, 0, 0, 0, false)
  }, [controls])

  // Handle View Events
  useEffect(() => {
    const handleApply = ({ camera }: ViewApplyEvent) => {
      if (!controlsRef.current) return
      const { position, target, mode } = camera

      // Switch mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      // Set camera
      controlsRef.current.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true, // enable transition
      )
    }

    const handleCapture = ({ name, description }: ViewCaptureRequest) => {
      if (!controlsRef.current) return

      const position = new Vector3()
      const target = new Vector3()
      controlsRef.current.getPosition(position)
      controlsRef.current.getTarget(target)

      const state = useEditor.getState()

      // Get currently selected zone if any
      const selectedZoneIds = state.selectedZoneId ? [state.selectedZoneId] : []

      state.addView({
        name,
        description,
        metadata: {},
        camera: {
          position: [position.x, position.y, position.z],
          target: [target.x, target.y, target.z],
          mode: state.cameraMode,
        },
        sceneState: {
          selectedLevelId: state.selectedFloorId,
          levelMode: state.viewMode === 'level' ? 'single-floor' : state.levelMode,
          visibleZoneIds: selectedZoneIds.length > 0 ? selectedZoneIds : undefined,
        },
      })
    }

    const handleNodeCapture = ({ nodeId }: NodeCameraCaptureRequest) => {
      if (!controlsRef.current) return

      const position = new Vector3()
      const target = new Vector3()
      controlsRef.current.getPosition(position)
      controlsRef.current.getTarget(target)

      const state = useEditor.getState()

      state.updateNode(nodeId, {
        camera: {
          position: [position.x, position.y, position.z],
          target: [target.x, target.y, target.z],
          mode: state.cameraMode,
        },
      })
    }

    emitter.on('view:apply', handleApply)
    emitter.on('view:request-capture', handleCapture)
    emitter.on('node:capture-camera', handleNodeCapture)

    return () => {
      emitter.off('view:apply', handleApply)
      emitter.off('view:request-capture', handleCapture)
      emitter.off('node:capture-camera', handleNodeCapture)
    }
  }, [])

  useEffect(() => {
    if (!controls) return

    if (selectedFloorId && !debug) {
      const floorY = (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * currentLevel
      const currentTarget = new Vector3()
      ;(controls as CameraControlsImpl).getTarget(currentTarget)
      ;(controls as CameraControlsImpl).moveTo(currentTarget.x, floorY, currentTarget.z, true)
      const boundaryBox = new Box3(
        new Vector3(-200, floorY - 25, -200),
        new Vector3(200, floorY + 25, 200),
      )
      ;(controls as CameraControlsImpl).setBoundary(boundaryBox)

      //  For debugging camera boundaries
      // const boxHelper = new Box3Helper(boundaryBox, 0xff0000);
      // scene.add(boxHelper);
    } else {
      ;(controls as CameraControlsImpl).setBoundary() // No argument to remove boundaries
      if (!debug) {
        ;(controls as CameraControlsImpl).setLookAt(40, 40, 40, 0, 0, 0, true)
      }
    }
  }, [currentLevel, controls, selectedFloorId, levelMode, debug])

  // Configure mouse buttons based on control mode and camera mode
  const mouseButtons = useMemo(() => {
    // Use ZOOM for orthographic camera, DOLLY for perspective camera
    const wheelAction =
      cameraMode === 'orthographic'
        ? CameraControlsImpl.ACTION.ZOOM
        : CameraControlsImpl.ACTION.DOLLY

    // In select mode, left-click can pan the camera (unless editing a zone)
    if (controlMode === 'select' && !selectedZoneId) {
      return {
        left: CameraControlsImpl.ACTION.SCREEN_PAN, // Similar to the sims
        middle: CameraControlsImpl.ACTION.SCREEN_PAN,
        right: CameraControlsImpl.ACTION.ROTATE,
        wheel: wheelAction,
      }
    }

    // In edit, delete, build, and guide modes, or when editing a zone,
    // disable left-click for camera (reserved for mode-specific actions)
    return {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: wheelAction,
    }
  }, [controlMode, cameraMode, selectedZoneId])

  const onControlStart = useCallback(() => {
    useEditor.getState().setMovingCamera(true)
  }, [])

  const onControlEnd = useCallback(() => {
    useEditor.getState().setMovingCamera(false)
  }, [])

  return (
    <CameraControls
      makeDefault
      maxDistance={debug ? 1000 : 100}
      maxPolarAngle={debug ? Math.PI : Math.PI / 2 - 0.1}
      minDistance={debug ? 0.1 : 10}
      minPolarAngle={0}
      mouseButtons={mouseButtons}
      onEnd={onControlEnd}
      onStart={onControlStart}
      ref={controlsRef}
    />
  )
}
