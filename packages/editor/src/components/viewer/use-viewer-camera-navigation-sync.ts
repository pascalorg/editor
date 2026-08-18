'use client'

import { type CameraPose, emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import type { Camera, OrthographicCamera, PerspectiveCamera } from 'three'
import { Vector3 } from 'three'
import { normalizeCameraPose } from '../../lib/camera-pose'
import { publishCameraPose } from '../../store/camera-pose-store'

const position = new Vector3()
const target = new Vector3()

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true
}

function isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
  return (camera as OrthographicCamera).isOrthographicCamera === true
}

function cameraViewWidth(camera: Camera, distance: number, width: number, height: number) {
  if (isPerspectiveCamera(camera)) {
    const fov = (camera.getEffectiveFOV() * Math.PI) / 180
    return Math.max(0.001, 2 * distance * Math.tan(fov / 2) * (width / Math.max(height, 1)))
  }
  if (isOrthographicCamera(camera)) {
    return Math.max(0.001, (camera.right - camera.left) / camera.zoom)
  }
  return Math.max(0.001, distance)
}

function applyViewWidth(
  controls: CameraControlsImpl,
  camera: Camera,
  viewWidth: number,
  width: number,
  height: number,
) {
  if (isPerspectiveCamera(camera)) {
    const fov = (camera.getEffectiveFOV() * Math.PI) / 180
    const denominator = 2 * Math.tan(fov / 2) * (width / Math.max(height, 1))
    if (denominator > 0) controls.dollyTo(Math.max(0.001, viewWidth / denominator), false)
    return
  }
  if (isOrthographicCamera(camera) && viewWidth > 0) {
    controls.zoomTo(Math.max(0.001, (camera.right - camera.left) / viewWidth), false)
  }
}

export function useViewerCameraNavigationSync(controls: RefObject<CameraControlsImpl | null>) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const suppressPublish = useRef(false)
  const pendingPose = useRef<CameraPose | null>(null)

  const publishCurrentPose = useCallback(() => {
    const control = controls.current
    if (!control || suppressPublish.current) return
    control.getPosition(position, false)
    control.getTarget(target, false)
    const projection = isPerspectiveCamera(camera)
      ? 'perspective'
      : isOrthographicCamera(camera)
        ? 'orthographic'
        : null
    if (!projection) return
    const pose = normalizeCameraPose({
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
      projection,
      viewWidth: cameraViewWidth(camera, position.distanceTo(target), size.width, size.height),
      ...(isPerspectiveCamera(camera) ? { fov: camera.fov } : {}),
    })
    if (pose) publishCameraPose(pose)
  }, [camera, controls, size.height, size.width])

  const applyPendingPose = useCallback(() => {
    const control = controls.current
    const pose = pendingPose.current
    if (!(control && pose)) return
    const projectionMatches =
      (pose.projection === 'perspective' && isPerspectiveCamera(camera)) ||
      (pose.projection === 'orthographic' && isOrthographicCamera(camera))
    if (!projectionMatches) return

    pendingPose.current = null
    suppressPublish.current = true
    try {
      if (pose.fov !== undefined && isPerspectiveCamera(camera)) {
        camera.fov = pose.fov
        camera.updateProjectionMatrix()
      }
      control.setLookAt(
        pose.position[0],
        pose.position[1],
        pose.position[2],
        pose.target[0],
        pose.target[1],
        pose.target[2],
        false,
      )
      if (pose.viewWidth !== undefined) {
        applyViewWidth(control, camera, pose.viewWidth, size.width, size.height)
      }
      control.update(0)
    } finally {
      suppressPublish.current = false
      publishCurrentPose()
    }
  }, [camera, controls, publishCurrentPose, size.height, size.width])

  useEffect(() => {
    applyPendingPose()
  }, [applyPendingPose])

  useEffect(() => {
    const applyPose = (value: CameraPose) => {
      const pose = normalizeCameraPose(value)
      if (!pose) return
      pendingPose.current = pose
      if (useViewer.getState().cameraMode !== pose.projection) {
        useViewer.getState().setCameraMode(pose.projection)
        return
      }
      applyPendingPose()
    }
    emitter.on('camera-controls:apply-pose', applyPose)
    return () => emitter.off('camera-controls:apply-pose', applyPose)
  }, [applyPendingPose])

  useEffect(() => {
    const frame = requestAnimationFrame(publishCurrentPose)
    return () => cancelAnimationFrame(frame)
  }, [publishCurrentPose])

  return publishCurrentPose
}
