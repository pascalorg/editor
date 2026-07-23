'use client'

import {
  type AnyNodeId,
  type CameraControlEvent,
  type CameraControlFitSceneEvent,
  type CameraPose,
  emitter,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { GRID_LAYER, useViewer, ZONE_LAYER } from '@pascal-app/viewer'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Box3,
  type Camera,
  type OrthographicCamera,
  type PerspectiveCamera,
  Spherical,
  Vector3,
} from 'three'
import {
  type CameraPoseApplicationPlan,
  normalizeCameraPose,
  planCameraPoseApplication,
  stepCameraPoseInterpolation,
  withCameraPoseDistance,
} from '../../lib/camera-pose'
import { EDITOR_LAYER } from '../../lib/constants'
import useEditor from '../../store/use-editor'
import {
  useActiveHandleDrag,
  useEndpointReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { createCameraDraggingLifecycle } from './camera-dragging-lifecycle'

const currentTarget = new Vector3()
const tempBox = new Box3()
const tempCenter = new Vector3()
const tempDelta = new Vector3()
const tempPosition = new Vector3()
const tempSize = new Vector3()
const tempTarget = new Vector3()
const transitionFreezePosition = new Vector3()
const transitionFreezeTarget = new Vector3()
const syncTarget = new Vector3()
const syncSpherical = new Spherical()
const keyboardPanSpherical = new Spherical()
const DEFAULT_MAX_POLAR_ANGLE = Math.PI / 2 - 0.1
const DEBUG_MAX_POLAR_ANGLE = Math.PI - 0.05
const NAVIGATION_SYNC_POSITION_EPSILON = 0.001
const NAVIGATION_SYNC_AZIMUTH_EPSILON = 0.0005
const NAVIGATION_SYNC_VIEW_WIDTH_EPSILON = 0.001
const KEYBOARD_PAN_VIEW_WIDTH_PER_SECOND = 0.65
const KEYBOARD_PAN_MIN_SPEED = 2
const KEYBOARD_PAN_MAX_SPEED = 55
type CameraMode = ReturnType<typeof useViewer.getState>['cameraMode']
type CameraPoseSnapshot = {
  mode: CameraMode
  position: [number, number, number]
  target: [number, number, number]
}
type NavigationCameraPoseSnapshot = {
  target: [number, number, number]
  azimuth: number
  viewWidth: number
}
type PendingNavigationCameraPoseSnapshot = NavigationCameraPoseSnapshot & {
  publishOnComplete: boolean
}
type CameraViewWidthUpdate =
  | { type: 'distance'; distance: number; viewWidth: number }
  | { type: 'zoom'; viewWidth: number; zoom: number }
  | { type: 'none'; viewWidth: number }

function writeVectorTuple(tuple: [number, number, number], vector: Vector3) {
  tuple[0] = vector.x
  tuple[1] = vector.y
  tuple[2] = vector.z
}

function saveCameraPose(
  control: CameraControlsImpl,
  mode: CameraMode,
  pose: CameraPoseSnapshot,
  position: Vector3,
  target: Vector3,
) {
  control.getPosition(position)
  control.getTarget(target)
  pose.mode = mode
  writeVectorTuple(pose.position, position)
  writeVectorTuple(pose.target, target)
}

function restoreCameraPose(control: CameraControlsImpl, pose: CameraPoseSnapshot) {
  control.setLookAt(
    pose.position[0],
    pose.position[1],
    pose.position[2],
    pose.target[0],
    pose.target[1],
    pose.target[2],
    false,
  )
}

function freezeCameraControlTransition(control: CameraControlsImpl) {
  // `stop()` snaps to the transition endpoint, so replace it with the current pose instead.
  control.getPosition(transitionFreezePosition, false)
  control.getTarget(transitionFreezeTarget, false)
  void control.setLookAt(
    transitionFreezePosition.x,
    transitionFreezePosition.y,
    transitionFreezePosition.z,
    transitionFreezeTarget.x,
    transitionFreezeTarget.y,
    transitionFreezeTarget.z,
    false,
  )
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

type KeyboardPanState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

function setKeyboardPanKey(state: KeyboardPanState, code: string, pressed: boolean): boolean {
  if (code === 'KeyW') {
    const changed = state.forward !== pressed
    state.forward = pressed
    return changed
  }
  if (code === 'KeyS') {
    const changed = state.backward !== pressed
    state.backward = pressed
    return changed
  }
  if (code === 'KeyA') {
    const changed = state.left !== pressed
    state.left = pressed
    return changed
  }
  if (code === 'KeyD') {
    const changed = state.right !== pressed
    state.right = pressed
    return changed
  }
  return false
}

function isKeyboardPanKey(code: string): boolean {
  return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
}

function hasKeyboardPanInput(state: KeyboardPanState): boolean {
  return state.forward || state.backward || state.left || state.right
}

type CameraViewportSize = {
  width: number
  height: number
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true
}

function isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
  return (camera as OrthographicCamera).isOrthographicCamera === true
}

function getCameraViewAspect(size: CameraViewportSize) {
  return Math.max(size.width, 1) / Math.max(size.height, 1)
}

function getCameraViewWidth(camera: Camera, distance: number, size: CameraViewportSize) {
  if (isPerspectiveCamera(camera)) {
    const fovRadians = (camera.getEffectiveFOV() * Math.PI) / 180
    return Math.max(0.001, 2 * distance * Math.tan(fovRadians / 2) * getCameraViewAspect(size))
  }

  if (isOrthographicCamera(camera)) {
    return Math.max(0.001, (camera.right - camera.left) / camera.zoom)
  }

  return Math.max(0.001, distance)
}

function getAngleDeltaRadians(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function nearestEquivalentRadians(angle: number, reference: number) {
  return reference + getAngleDeltaRadians(angle, reference)
}

function clampFinite(value: number, min: number, max: number) {
  const resolvedMin = Number.isFinite(min) ? min : Number.NEGATIVE_INFINITY
  const resolvedMax = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  return Math.min(Math.max(value, resolvedMin), resolvedMax)
}

function clampCameraControlDistance(control: CameraControlsImpl, distance: number) {
  const bounds = control as { minDistance?: number; maxDistance?: number }
  return clampFinite(
    distance,
    bounds.minDistance ?? Number.NEGATIVE_INFINITY,
    bounds.maxDistance ?? Number.POSITIVE_INFINITY,
  )
}

function clampCameraControlZoom(control: CameraControlsImpl, zoom: number) {
  const bounds = control as { minZoom?: number; maxZoom?: number }
  return clampFinite(
    zoom,
    bounds.minZoom ?? Number.NEGATIVE_INFINITY,
    bounds.maxZoom ?? Number.POSITIVE_INFINITY,
  )
}

function isCameraAtNavigationPose(
  pose: NavigationCameraPoseSnapshot,
  target: Vector3,
  azimuth: number,
  viewWidth: number,
) {
  return (
    Math.abs(pose.target[0] - target.x) < NAVIGATION_SYNC_POSITION_EPSILON &&
    Math.abs(pose.target[1] - target.y) < NAVIGATION_SYNC_POSITION_EPSILON &&
    Math.abs(pose.target[2] - target.z) < NAVIGATION_SYNC_POSITION_EPSILON &&
    Math.abs(getAngleDeltaRadians(pose.azimuth, azimuth)) < NAVIGATION_SYNC_AZIMUTH_EPSILON &&
    Math.abs(pose.viewWidth - viewWidth) < NAVIGATION_SYNC_VIEW_WIDTH_EPSILON
  )
}

function getCameraDistanceForViewWidth(
  camera: Camera,
  viewWidth: number,
  size: CameraViewportSize,
) {
  if (!isPerspectiveCamera(camera)) {
    return null
  }

  const fovRadians = (camera.getEffectiveFOV() * Math.PI) / 180
  const denominator = 2 * Math.tan(fovRadians / 2) * getCameraViewAspect(size)

  return denominator > 0 ? Math.max(0.001, viewWidth / denominator) : null
}

function getCameraZoomForViewWidth(camera: Camera, viewWidth: number) {
  if (!isOrthographicCamera(camera)) {
    return null
  }

  return viewWidth > 0 ? Math.max(0.001, (camera.right - camera.left) / viewWidth) : null
}

function resolveCameraViewWidthUpdate(
  control: CameraControlsImpl,
  camera: Camera,
  viewWidth: number,
  size: CameraViewportSize,
): CameraViewWidthUpdate {
  const nextDistance = getCameraDistanceForViewWidth(camera, viewWidth, size)
  if (nextDistance !== null) {
    const appliedDistance = clampCameraControlDistance(control, nextDistance)
    return {
      type: 'distance',
      distance: appliedDistance,
      viewWidth: getCameraViewWidth(camera, appliedDistance, size),
    }
  }

  const nextZoom = getCameraZoomForViewWidth(camera, viewWidth)
  if (nextZoom !== null) {
    const appliedZoom = clampCameraControlZoom(control, nextZoom)
    if (isOrthographicCamera(camera)) {
      return {
        type: 'zoom',
        zoom: appliedZoom,
        viewWidth: Math.max(0.001, (camera.right - camera.left) / Math.max(appliedZoom, 0.001)),
      }
    }
  }

  return { type: 'none', viewWidth }
}

function applyCameraViewWidth(
  control: CameraControlsImpl,
  update: CameraViewWidthUpdate,
  enableTransition = true,
) {
  if (update.type === 'distance') {
    control.dollyTo(update.distance, enableTransition)
    return
  }

  if (update.type === 'zoom') {
    control.zoomTo(update.zoom, enableTransition)
  }
}

function useFirstPersonCameraPoseRestore(
  controls: { current: CameraControlsImpl | null },
  isFirstPersonMode: boolean,
  cameraMode: CameraMode,
) {
  const restorePose = useRef<CameraPoseSnapshot>({
    mode: cameraMode,
    position: [0, 0, 0],
    target: [0, 0, 0],
  })
  const hasRestorePose = useRef(false)
  const isRestoring = useRef(false)
  const wasFirstPersonMode = useRef(isFirstPersonMode)
  const snapshotPosition = useRef(new Vector3())
  const snapshotTarget = useRef(new Vector3())

  useFrame(() => {
    if (isFirstPersonMode || isRestoring.current) return
    const control = controls.current
    if (!control) return

    saveCameraPose(
      control,
      cameraMode,
      restorePose.current,
      snapshotPosition.current,
      snapshotTarget.current,
    )
    hasRestorePose.current = true
  })

  useEffect(() => {
    const wasFirstPerson = wasFirstPersonMode.current
    wasFirstPersonMode.current = isFirstPersonMode

    if (isFirstPersonMode) {
      return
    }

    if (!wasFirstPerson || !hasRestorePose.current) return

    const pose = restorePose.current
    isRestoring.current = true
    useViewer.getState().setCameraMode(pose.mode)

    const restoreFrame = requestAnimationFrame(() => {
      const currentControls = controls.current
      if (currentControls) {
        restoreCameraPose(currentControls, pose)
      }
      isRestoring.current = false
    })

    return () => {
      cancelAnimationFrame(restoreFrame)
      isRestoring.current = false
    }
  }, [controls, isFirstPersonMode])

  return useCallback(() => isRestoring.current, [])
}

export const CustomCameraControls = () => {
  const controls = useRef<CameraControlsImpl | null>(null)
  const pendingAppliedPose = useRef<CameraPoseApplicationPlan | null>(null)
  const activePoseInterpolation = useRef<{
    camera: Camera
    control: CameraControlsImpl
    plan: CameraPoseApplicationPlan
  } | null>(null)
  const suppressPoseEvents = useRef(false)
  const keyboardPanKeys = useRef<KeyboardPanState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
  })
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const allowUndergroundCamera = useEditor((s) => s.allowUndergroundCamera)
  const isFloorplanOpen = useEditor((s) => s.isFloorplanOpen)
  const selection = useViewer((s) => s.selection)
  const cameraMode = useViewer((state) => state.cameraMode)
  const isRestoringFirstPersonPose = useFirstPersonCameraPoseRestore(
    controls,
    isFirstPersonMode,
    cameraMode,
  )
  const currentLevelId = selection.levelId
  const firstLoad = useRef(true)
  const lastPublishedNavigationSync = useRef<NavigationCameraPoseSnapshot | null>(null)
  const pendingFloorplanNavigationPose = useRef<PendingNavigationCameraPoseSnapshot | null>(null)
  const lastApplied2dNavigationRevision = useRef(0)
  const savedSmoothTimeRef = useRef<number | null>(null)
  const maxPolarAngle =
    !isPreviewMode && allowUndergroundCamera ? DEBUG_MAX_POLAR_ANGLE : DEFAULT_MAX_POLAR_ANGLE
  const clearPendingFloorplanNavigationPose = useCallback(() => {
    pendingFloorplanNavigationPose.current = null
    if (savedSmoothTimeRef.current !== null && controls.current) {
      controls.current.smoothTime = savedSmoothTimeRef.current
      savedSmoothTimeRef.current = null
    }
  }, [])

  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const raycaster = useThree((state) => state.raycaster)
  const viewportSize = useThree((state) => state.size)
  const cameraDraggingLifecycle = useMemo(
    () =>
      createCameraDraggingLifecycle({
        setDragging: (dragging) => useViewer.getState().setCameraDragging(dragging),
      }),
    [],
  )
  useEffect(() => () => cameraDraggingLifecycle.end(), [cameraDraggingLifecycle])
  useEffect(() => {
    camera.layers.enable(EDITOR_LAYER)
    camera.layers.enable(GRID_LAYER)
    raycaster.layers.enable(EDITOR_LAYER)
    raycaster.layers.enable(ZONE_LAYER)
  }, [camera, raycaster])

  const freezeActivePoseInterpolation = useCallback(() => {
    const active = activePoseInterpolation.current
    if (!active) return

    activePoseInterpolation.current = null
    freezeCameraControlTransition(active.control)
  }, [])

  const cancelPoseApplication = useCallback(() => {
    pendingAppliedPose.current = null
    try {
      freezeActivePoseInterpolation()
    } finally {
      suppressPoseEvents.current = false
    }
  }, [freezeActivePoseInterpolation])

  const beginLocalCameraInteraction = useCallback(
    ({ dragging = true }: { dragging?: boolean } = {}) => {
      cancelPoseApplication()
      if (dragging) cameraDraggingLifecycle.begin()
      emitter.emit('camera-controls:interaction-start', undefined)
    },
    [cameraDraggingLifecycle, cancelPoseApplication],
  )

  const applyPendingPose = useCallback(() => {
    if (isFirstPersonMode) {
      cancelPoseApplication()
      return
    }

    const plan = pendingAppliedPose.current
    const control = controls.current

    const active = activePoseInterpolation.current
    if (active && (active.camera !== camera || active.control !== control)) {
      try {
        freezeActivePoseInterpolation()
      } finally {
        if (!plan) suppressPoseEvents.current = false
      }
    }

    if (!(plan && control)) return

    const cameraMatchesProjection =
      (plan.pose.projection === 'perspective' && isPerspectiveCamera(camera)) ||
      (plan.pose.projection === 'orthographic' && isOrthographicCamera(camera))
    if (!cameraMatchesProjection) return

    pendingAppliedPose.current = null
    if (plan.perspectiveFov !== null && isPerspectiveCamera(camera)) {
      camera.fov = plan.perspectiveFov
      camera.updateProjectionMatrix()
    }
    let appliedPlan = plan
    if (plan.pose.viewWidth !== undefined) {
      const viewWidthUpdate = resolveCameraViewWidthUpdate(
        control,
        camera,
        plan.pose.viewWidth,
        viewportSize,
      )
      if (viewWidthUpdate.type === 'distance') {
        appliedPlan = {
          ...plan,
          pose: withCameraPoseDistance(plan.pose, viewWidthUpdate.distance),
        }
      } else if (viewWidthUpdate.type === 'zoom') {
        applyCameraViewWidth(control, viewWidthUpdate, false)
      }
    }

    clearPendingFloorplanNavigationPose()
    activePoseInterpolation.current = { camera, control, plan: appliedPlan }
  }, [
    camera,
    cancelPoseApplication,
    clearPendingFloorplanNavigationPose,
    freezeActivePoseInterpolation,
    isFirstPersonMode,
    viewportSize,
  ])

  useEffect(() => {
    applyPendingPose()
  }, [applyPendingPose])

  useEffect(() => {
    const handleAppliedPose = (pose: CameraPose) => {
      if (isFirstPersonMode) return

      const plan = planCameraPoseApplication(pose)
      if (!plan) return

      pendingAppliedPose.current = plan
      suppressPoseEvents.current = true

      if (useViewer.getState().cameraMode !== plan.pose.projection) {
        freezeActivePoseInterpolation()
        useViewer.getState().setCameraMode(plan.pose.projection)
        return
      }

      applyPendingPose()
    }

    emitter.on('camera-controls:apply-pose', handleAppliedPose)
    emitter.on('camera-controls:cancel-pose', cancelPoseApplication)
    return () => {
      emitter.off('camera-controls:apply-pose', handleAppliedPose)
      emitter.off('camera-controls:cancel-pose', cancelPoseApplication)
    }
  }, [applyPendingPose, cancelPoseApplication, freezeActivePoseInterpolation, isFirstPersonMode])

  useEffect(() => cancelPoseApplication, [cancelPoseApplication])

  useEffect(() => {
    // Dev-only: deterministic camera poses for screenshot/automation tooling.
    // A getter, not a snapshot — drei recreates the impl when the default
    // camera changes, so a captured instance goes stale.
    if (process.env.NODE_ENV !== 'development') return
    const w = window as typeof window & {
      __pascalCameraControls?: (() => CameraControlsImpl | null) | null
    }
    w.__pascalCameraControls = () => controls.current
    return () => {
      w.__pascalCameraControls = null
    }
  }, [])

  useEffect(() => {
    if (isPreviewMode || isFirstPersonMode || isRestoringFirstPersonPose()) return
    let targetY = 0
    if (currentLevelId) {
      const levelMesh = sceneRegistry.nodes.get(currentLevelId)
      if (levelMesh) {
        targetY = levelMesh.position.y
      }
    }
    if (!controls.current) return
    if (firstLoad.current) {
      firstLoad.current = false
      clearPendingFloorplanNavigationPose()
      controls.current.setLookAt(20, 20, 20, 0, 0, 0, true)
    }
    controls.current.getTarget(currentTarget)
    clearPendingFloorplanNavigationPose()
    controls.current.moveTo(currentTarget.x, targetY, currentTarget.z, true)
  }, [
    clearPendingFloorplanNavigationPose,
    currentLevelId,
    isPreviewMode,
    isFirstPersonMode,
    isRestoringFirstPersonPose,
  ])

  useEffect(() => {
    if (isFirstPersonMode || !controls.current) return

    controls.current.maxPolarAngle = maxPolarAngle
    controls.current.minPolarAngle = 0

    if (controls.current.polarAngle > maxPolarAngle) {
      controls.current.rotateTo(controls.current.azimuthAngle, maxPolarAngle, true)
    }
  }, [isFirstPersonMode, maxPolarAngle])

  const focusNode = useCallback(
    (nodeId: string) => {
      if (isPreviewMode || isFirstPersonMode || !controls.current) return

      const object3D = sceneRegistry.nodes.get(nodeId)
      if (!object3D) return

      tempBox.setFromObject(object3D)
      if (tempBox.isEmpty()) return

      tempBox.getCenter(tempCenter)
      controls.current.getPosition(tempPosition)
      controls.current.getTarget(tempTarget)
      tempDelta.copy(tempCenter).sub(tempTarget)

      clearPendingFloorplanNavigationPose()
      controls.current.setLookAt(
        tempPosition.x + tempDelta.x,
        tempPosition.y + tempDelta.y,
        tempPosition.z + tempDelta.z,
        tempCenter.x,
        tempCenter.y,
        tempCenter.z,
        true,
      )
    },
    [clearPendingFloorplanNavigationPose, isPreviewMode, isFirstPersonMode],
  )

  useEffect(() => {
    if (isFirstPersonMode) return

    return useEditor.subscribe((state) => {
      const pose = state.navigationSyncPose
      if (pose?.source !== '2d' || pose.revision === lastApplied2dNavigationRevision.current) return

      const control = controls.current
      if (!control) return

      lastApplied2dNavigationRevision.current = pose.revision
      const targetAzimuth = nearestEquivalentRadians(pose.azimuth, control.azimuthAngle)
      const viewWidthUpdate = resolveCameraViewWidthUpdate(
        control,
        camera,
        pose.viewWidth,
        viewportSize,
      )
      pendingFloorplanNavigationPose.current = {
        target: [...pose.target],
        azimuth: targetAzimuth,
        viewWidth: viewWidthUpdate.viewWidth,
        publishOnComplete:
          Math.abs(viewWidthUpdate.viewWidth - pose.viewWidth) >=
          NAVIGATION_SYNC_VIEW_WIDTH_EPSILON,
      }
      // Match 3D settle time to 2D exponential decay (τ=90ms). SmoothDamp's
      // effective time constant is smoothTime/2, so smoothTime=0.18 gives
      // τ≈90ms and visual convergence in ~350-400ms, matching the 2D panel.
      if (savedSmoothTimeRef.current === null) {
        savedSmoothTimeRef.current = control.smoothTime
      }
      control.smoothTime = 0.18
      control.moveTo(pose.target[0], pose.target[1], pose.target[2], true)
      control.rotateTo(targetAzimuth, control.polarAngle, true)
      applyCameraViewWidth(control, viewWidthUpdate)
    })
  }, [camera, isFirstPersonMode, viewportSize])

  const publishCurrentNavigationPose = useCallback(() => {
    if (isFirstPersonMode || !controls.current) return

    controls.current.getTarget(syncTarget, false)
    controls.current.getSpherical(syncSpherical, false)
    const viewWidth = getCameraViewWidth(camera, syncSpherical.radius, viewportSize)

    const pendingFloorplanPose = pendingFloorplanNavigationPose.current
    if (pendingFloorplanPose) {
      // The camera is still damping toward a 2D-originated pose; do not echo
      // intermediate 3D poses back into the floorplan.
      if (
        isCameraAtNavigationPose(pendingFloorplanPose, syncTarget, syncSpherical.theta, viewWidth)
      ) {
        lastPublishedNavigationSync.current = pendingFloorplanPose
        clearPendingFloorplanNavigationPose()
        if (pendingFloorplanPose.publishOnComplete) {
          useEditor.getState().publishNavigationSyncPose({
            source: '3d',
            target: [
              pendingFloorplanPose.target[0],
              pendingFloorplanPose.target[1],
              pendingFloorplanPose.target[2],
            ],
            azimuth: pendingFloorplanPose.azimuth,
            viewWidth: pendingFloorplanPose.viewWidth,
          })
        }
      }
      return
    }

    const previous = lastPublishedNavigationSync.current
    if (
      previous &&
      Math.abs(previous.target[0] - syncTarget.x) < NAVIGATION_SYNC_POSITION_EPSILON &&
      Math.abs(previous.target[1] - syncTarget.y) < NAVIGATION_SYNC_POSITION_EPSILON &&
      Math.abs(previous.target[2] - syncTarget.z) < NAVIGATION_SYNC_POSITION_EPSILON &&
      Math.abs(getAngleDeltaRadians(previous.azimuth, syncSpherical.theta)) <
        NAVIGATION_SYNC_AZIMUTH_EPSILON &&
      Math.abs(previous.viewWidth - viewWidth) < NAVIGATION_SYNC_VIEW_WIDTH_EPSILON
    ) {
      return
    }

    lastPublishedNavigationSync.current = {
      target: [syncTarget.x, syncTarget.y, syncTarget.z],
      azimuth: syncSpherical.theta,
      viewWidth,
    }
    useEditor.getState().publishNavigationSyncPose({
      source: '3d',
      target: [syncTarget.x, syncTarget.y, syncTarget.z],
      azimuth: syncSpherical.theta,
      viewWidth,
    })
  }, [camera, clearPendingFloorplanNavigationPose, isFirstPersonMode, viewportSize])

  const publishCurrentPose = useCallback(() => {
    if (isFirstPersonMode || suppressPoseEvents.current || !controls.current) return

    controls.current.getPosition(tempPosition, false)
    controls.current.getTarget(tempTarget, false)
    const targetDistance = tempPosition.distanceTo(tempTarget)
    const projection = isPerspectiveCamera(camera)
      ? 'perspective'
      : isOrthographicCamera(camera)
        ? 'orthographic'
        : null
    if (!projection) return

    const pose = normalizeCameraPose({
      position: [tempPosition.x, tempPosition.y, tempPosition.z],
      target: [tempTarget.x, tempTarget.y, tempTarget.z],
      projection,
      viewWidth: getCameraViewWidth(camera, targetDistance, viewportSize),
      ...(isPerspectiveCamera(camera) ? { fov: camera.fov } : {}),
    })
    if (pose) {
      emitter.emit('camera-controls:pose', pose)
    }
  }, [camera, isFirstPersonMode, viewportSize])

  const handleCameraUpdate = useCallback(() => {
    publishCurrentNavigationPose()
    publishCurrentPose()
  }, [publishCurrentNavigationPose, publishCurrentPose])

  useEffect(() => {
    if (isFirstPersonMode || (!isFloorplanOpen && currentLevelId === null)) return

    const frame = requestAnimationFrame(() => {
      lastPublishedNavigationSync.current = null
      publishCurrentNavigationPose()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [currentLevelId, isFirstPersonMode, isFloorplanOpen, publishCurrentNavigationPose])

  useFrame((_, delta) => {
    if (isFirstPersonMode || !controls.current) return

    const activePose = activePoseInterpolation.current
    if (activePose) {
      const control = controls.current
      if (activePose.camera !== camera || activePose.control !== control) {
        try {
          freezeActivePoseInterpolation()
        } finally {
          if (!pendingAppliedPose.current) suppressPoseEvents.current = false
        }
      } else {
        control.getPosition(tempPosition, false)
        control.getTarget(tempTarget, false)
        const step = stepCameraPoseInterpolation(
          [tempPosition.x, tempPosition.y, tempPosition.z],
          [tempTarget.x, tempTarget.y, tempTarget.z],
          activePose.plan.pose,
          delta,
        )
        try {
          // Transition-enabled calls retain one rest listener each, so this frame loop owns smoothing.
          void control.setLookAt(
            step.position[0],
            step.position[1],
            step.position[2],
            step.target[0],
            step.target[1],
            step.target[2],
            false,
          )
          control.update(0)
        } catch {
          if (activePoseInterpolation.current === activePose) {
            activePoseInterpolation.current = null
            suppressPoseEvents.current = false
          }
        }
        if (step.settled && activePoseInterpolation.current === activePose) {
          activePoseInterpolation.current = null
          suppressPoseEvents.current = false
        }
      }
    }

    const panKeys = keyboardPanKeys.current
    const horizontal = (panKeys.right ? 1 : 0) - (panKeys.left ? 1 : 0)
    const vertical = (panKeys.forward ? 1 : 0) - (panKeys.backward ? 1 : 0)
    if (horizontal === 0 && vertical === 0) return

    const control = controls.current

    control.getSpherical(keyboardPanSpherical, false)
    const viewWidth = getCameraViewWidth(camera, keyboardPanSpherical.radius, viewportSize)
    const speed = Math.min(
      Math.max(viewWidth * KEYBOARD_PAN_VIEW_WIDTH_PER_SECOND, KEYBOARD_PAN_MIN_SPEED),
      KEYBOARD_PAN_MAX_SPEED,
    )
    const step = (speed * Math.min(delta, 0.05)) / Math.hypot(horizontal, vertical)

    clearPendingFloorplanNavigationPose()
    if (horizontal !== 0) control.truck(horizontal * step, 0, true)
    if (vertical !== 0) control.forward(vertical * step, true)
  }, 0)

  // Configure mouse buttons based on control mode and camera mode
  const mouseButtons = useMemo(() => {
    // Use ZOOM for orthographic camera, DOLLY for perspective camera
    const wheelAction =
      cameraMode === 'orthographic'
        ? CameraControlsImpl.ACTION.ZOOM
        : CameraControlsImpl.ACTION.DOLLY

    return {
      left: isPreviewMode ? CameraControlsImpl.ACTION.SCREEN_PAN : CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: wheelAction,
    }
  }, [cameraMode, isPreviewMode])

  // Touch gestures (mobile / trackpad).
  // - One finger drag    → rotate by default (much easier on a phone), but
  //                        falls back to NONE while the user is actively
  //                        placing/moving something OR in box-select mode,
  //                        so the editor's pointer handlers (place tool,
  //                        drag-to-move endpoint, marquee selection drag)
  //                        keep priority over the camera.
  //                        In preview mode it's TOUCH_TRUCK (pan), matching
  //                        preview's left = SCREEN_PAN.
  // - Two finger pinch   → zoom + pan together (TOUCH_DOLLY_TRUCK for
  //                        perspective, TOUCH_ZOOM_TRUCK for orthographic).
  // - Three finger drag  → rotate, so the camera is always orbitable even
  //                        when one-finger is suppressed by an active
  //                        editor action.
  const tool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const selectionTool = useEditor((s) => s.floorplanSelectionTool)
  const movingNode = useMovingNode()
  const endpointReshape = useEndpointReshape()
  const activeHandleDrag = useActiveHandleDrag()
  const isBoxSelectActive = mode === 'select' && selectionTool === 'marquee'
  const isInteracting = Boolean(
    tool || movingNode || endpointReshape || activeHandleDrag || isBoxSelectActive,
  )
  const touches = useMemo(() => {
    const twoFingerAction =
      cameraMode === 'orthographic'
        ? CameraControlsImpl.ACTION.TOUCH_ZOOM_TRUCK
        : CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK

    const oneFingerAction = isPreviewMode
      ? CameraControlsImpl.ACTION.TOUCH_TRUCK
      : isInteracting
        ? CameraControlsImpl.ACTION.NONE
        : CameraControlsImpl.ACTION.TOUCH_ROTATE

    return {
      one: oneFingerAction,
      two: twoFingerAction,
      three: CameraControlsImpl.ACTION.TOUCH_ROTATE,
    }
  }, [cameraMode, isPreviewMode, isInteracting])

  useEffect(() => {
    if (isFirstPersonMode) return

    const keyState = {
      shiftRight: false,
      shiftLeft: false,
      controlRight: false,
      controlLeft: false,
      space: false,
    }
    let ownsNavigationCursor = false
    let panPointerId: number | null = null
    let panPointerButton: number | null = null

    const clearKeyboardPanKeys = () => {
      keyboardPanKeys.current.forward = false
      keyboardPanKeys.current.backward = false
      keyboardPanKeys.current.left = false
      keyboardPanKeys.current.right = false
    }

    const setNavigationCursor = (cursor: 'grab' | 'grabbing') => {
      document.body.style.cursor = cursor
      gl.domElement.style.cursor = cursor
      ownsNavigationCursor = true
    }

    const clearNavigationCursor = () => {
      if (
        ownsNavigationCursor &&
        (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing')
      ) {
        document.body.style.cursor = ''
      }
      if (ownsNavigationCursor && gl.domElement.style.cursor === 'grab') {
        gl.domElement.style.cursor = ''
      }
      if (ownsNavigationCursor && gl.domElement.style.cursor === 'grabbing') {
        gl.domElement.style.cursor = ''
      }
      ownsNavigationCursor = false
    }

    const updateNavigationCursor = () => {
      if (panPointerId !== null) {
        setNavigationCursor('grabbing')
        return
      }

      if (keyState.space) {
        setNavigationCursor('grab')
        return
      }

      clearNavigationCursor()
    }

    const updateConfig = () => {
      if (!controls.current) return

      const shift = keyState.shiftRight || keyState.shiftLeft
      const control = keyState.controlRight || keyState.controlLeft
      const space = keyState.space

      const wheelAction =
        cameraMode === 'orthographic'
          ? CameraControlsImpl.ACTION.ZOOM
          : CameraControlsImpl.ACTION.DOLLY
      controls.current.mouseButtons.wheel = wheelAction
      controls.current.mouseButtons.middle = CameraControlsImpl.ACTION.SCREEN_PAN
      controls.current.mouseButtons.right = CameraControlsImpl.ACTION.ROTATE
      if (isPreviewMode) {
        // In preview mode, left-click is always pan (viewer-style)
        controls.current.mouseButtons.left = CameraControlsImpl.ACTION.SCREEN_PAN
      } else if (space) {
        controls.current.mouseButtons.left = CameraControlsImpl.ACTION.SCREEN_PAN
      } else {
        controls.current.mouseButtons.left = CameraControlsImpl.ACTION.NONE
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isKeyboardPanKey(event.code)) {
        if (
          !(event.metaKey || event.ctrlKey || event.altKey) &&
          !isEditableKeyboardTarget(event.target)
        ) {
          const changed = setKeyboardPanKey(keyboardPanKeys.current, event.code, true)
          if (changed) beginLocalCameraInteraction()
          clearPendingFloorplanNavigationPose()
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (event.code === 'Space') {
        if (isEditableKeyboardTarget(event.target)) return
        event.preventDefault()
        keyState.space = true
        updateNavigationCursor()
      }
      if (event.code === 'ShiftRight') {
        keyState.shiftRight = true
      }
      if (event.code === 'ShiftLeft') {
        keyState.shiftLeft = true
      }
      if (event.code === 'ControlRight') {
        keyState.controlRight = true
      }
      if (event.code === 'ControlLeft') {
        keyState.controlLeft = true
      }
      updateConfig()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (isKeyboardPanKey(event.code)) {
        const changed = setKeyboardPanKey(keyboardPanKeys.current, event.code, false)
        if (changed) {
          if (!hasKeyboardPanInput(keyboardPanKeys.current)) {
            cameraDraggingLifecycle.end()
          }
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (event.code === 'Space') {
        keyState.space = false
        if (panPointerButton === 0) {
          panPointerId = null
          panPointerButton = null
        }
        updateNavigationCursor()
      }
      if (event.code === 'ShiftRight') {
        keyState.shiftRight = false
      }
      if (event.code === 'ShiftLeft') {
        keyState.shiftLeft = false
      }
      if (event.code === 'ControlRight') {
        keyState.controlRight = false
      }
      if (event.code === 'ControlLeft') {
        keyState.controlLeft = false
      }
      updateConfig()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !gl.domElement.contains(event.target)) return
      clearPendingFloorplanNavigationPose()
      if (event.button !== 1 && !(event.button === 0 && keyState.space)) return

      panPointerId = event.pointerId
      panPointerButton = event.button
      updateNavigationCursor()
    }

    const onWheel = () => {
      beginLocalCameraInteraction()
      cameraDraggingLifecycle.scheduleEnd()
      clearPendingFloorplanNavigationPose()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (panPointerId === null) return
      if (event.type !== 'pointercancel' && event.pointerId !== panPointerId) return
      if (event.type !== 'pointercancel' && event.button !== panPointerButton) return

      panPointerId = null
      panPointerButton = null
      updateNavigationCursor()
    }

    const onBlur = () => {
      keyState.space = false
      clearKeyboardPanKeys()
      panPointerId = null
      panPointerButton = null
      clearNavigationCursor()
      cameraDraggingLifecycle.end()
      updateConfig()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    window.addEventListener('blur', onBlur)
    gl.domElement.addEventListener('wheel', onWheel, { capture: true, passive: true })
    updateConfig()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      window.removeEventListener('blur', onBlur)
      gl.domElement.removeEventListener('wheel', onWheel, true)
      clearKeyboardPanKeys()
      clearNavigationCursor()
      cameraDraggingLifecycle.end()
    }
  }, [
    beginLocalCameraInteraction,
    cameraDraggingLifecycle,
    cameraMode,
    gl,
    isPreviewMode,
    isFirstPersonMode,
    clearPendingFloorplanNavigationPose,
  ])

  // Cancel any in-progress 2D-origin navigation pose when the user starts
  // dragging (right-click orbit, middle-click pan, touch). `controlstart`
  // fires only for user pointer interactions — not for programmatic
  // moveTo/rotateTo which emit `transitionstart` instead. It also fires for
  // pointerdowns whose button is mapped to ACTION.NONE (plain left click in
  // edit mode); those must not flag the camera as dragging — no rest/sleep
  // ever follows to clear the flag, which would leave canvas clicks
  // (selection, placement) suppressed until the next real camera move.
  const handleControlStart = useCallback(() => {
    clearPendingFloorplanNavigationPose()
    beginLocalCameraInteraction({
      dragging: controls.current
        ? controls.current.currentAction !== CameraControlsImpl.ACTION.NONE
        : false,
    })
  }, [beginLocalCameraInteraction, clearPendingFloorplanNavigationPose])

  // Preview mode: auto-navigate camera to selected node (viewer behavior)
  const previewTargetNodeId = isPreviewMode
    ? (selection.zoneId ?? selection.levelId ?? selection.buildingId)
    : null

  useEffect(() => {
    if (!(isPreviewMode && controls.current) || isFirstPersonMode) return

    const nodes = useScene.getState().nodes
    let node = previewTargetNodeId ? nodes[previewTargetNodeId] : null

    if (!previewTargetNodeId) {
      const site = Object.values(nodes).find((n) => n.type === 'site')
      node = site || null
    }
    if (!node) return

    // Check if node has a saved camera
    if (node.camera) {
      const { position, target } = node.camera
      if (
        position &&
        target &&
        position.length >= 3 &&
        target.length >= 3 &&
        position.every((v) => v !== null && v !== undefined) &&
        target.every((v) => v !== null && v !== undefined)
      ) {
        requestAnimationFrame(() => {
          if (!controls.current) return
          controls.current.setLookAt(
            position[0],
            position[1],
            position[2],
            target[0],
            target[1],
            target[2],
            true,
          )
        })
      }
      return
    }

    if (!previewTargetNodeId) return

    // Calculate camera position from bounding box
    const object3D = sceneRegistry.nodes.get(previewTargetNodeId)
    if (!object3D) return

    tempBox.setFromObject(object3D)
    tempBox.getCenter(tempCenter)
    tempBox.getSize(tempSize)

    const maxDim = Math.max(tempSize.x, tempSize.y, tempSize.z)
    const distance = Math.max(maxDim * 2, 15)

    controls.current.setLookAt(
      tempCenter.x + distance * 0.7,
      tempCenter.y + distance * 0.5,
      tempCenter.z + distance * 0.7,
      tempCenter.x,
      tempCenter.y,
      tempCenter.z,
      true,
    )
  }, [isPreviewMode, isFirstPersonMode, previewTargetNodeId])

  // Preset capture auto-framing — when `setCaptureMode({ mode: 'preset',
  // isolated })` fires, fly the camera to a pose that fits the union
  // bounds of the isolated subtree inside the locked square crop. The
  // user can still pan / orbit / zoom from there; we only set the
  // initial pose. On exit (`mode: 'idle'`), we restore the previous
  // pose so the user lands back exactly where they were before the
  // modal opened.
  const captureMode = useEditor((s) => s.captureMode)
  useEffect(() => {
    if (isFirstPersonMode) return
    if (!controls.current) return
    if (captureMode.mode !== 'preset') return
    const ids = captureMode.isolated
    if (ids.length === 0) return

    // Stash the pre-capture pose so we can restore it on exit. Using
    // a ref keeps the value across the cleanup phase without
    // re-renders.
    const restorePos = new Vector3()
    const restoreTarget = new Vector3()
    controls.current.getPosition(restorePos)
    controls.current.getTarget(restoreTarget)

    // Union the bounds of every isolated subtree root. `setFromObject`
    // walks the Three.js descendants automatically, so this picks up
    // synthesized children (door/window cutouts under a wall, etc.).
    tempBox.makeEmpty()
    for (const id of ids) {
      const obj = sceneRegistry.nodes.get(id)
      if (!obj) continue
      const sub = new Box3().setFromObject(obj)
      if (!sub.isEmpty()) tempBox.union(sub)
    }
    if (captureMode.framingBounds) {
      const { center, max, min, size } = captureMode.framingBounds
      const fallbackHeight = Math.max(Math.max(size[0], size[1]) * 0.35, 2.5)
      const minY = tempBox.isEmpty() ? 0 : tempBox.min.y
      const maxY = tempBox.isEmpty() ? fallbackHeight : tempBox.max.y
      tempBox.min.set(min[0], minY, min[1])
      tempBox.max.set(max[0], Math.max(maxY, minY + 0.1), max[1])
      tempCenter.set(center[0], (tempBox.min.y + tempBox.max.y) / 2, center[1])
      tempSize.set(size[0], tempBox.max.y - tempBox.min.y, size[1])
    } else {
      if (tempBox.isEmpty()) return

      tempBox.getCenter(tempCenter)
      tempBox.getSize(tempSize)
    }

    // Distance heuristic: fit the subject inside the 75%-of-shorter-
    // side square crop with comfortable padding. Multiplier 2.4 leaves
    // ~25-30% margin around the bounds so the user can frame without
    // immediately needing to zoom out, but isn't so far away that the
    // subject reads as small in the thumbnail.
    const maxDim = Math.max(tempSize.x, tempSize.y, tempSize.z)
    const distance = Math.max(maxDim * 2.4, 4)

    // Frame the subject from a 3/4 view of its front face. The node's
    // local +Z is its forward axis in this scene's authoring convention
    // (the face the user sets up to be photographed). When a single
    // subtree is isolated we read its yaw and rotate the camera around
    // the bounds center so the framing follows the user's authored
    // orientation; for multi-isolate sets we fall back to world +Z.
    // The 3/4 view offsets the camera by 35° to the right of dead-on
    // so both the front face and a side are visible — the "nice angle"
    // that reads as a product shot rather than a flat elevation. ~25°
    // elevation keeps the top visible without going isometric.
    const SIDE_OFFSET_RAD = (35 * Math.PI) / 180
    const ELEVATION_RAD = (25 * Math.PI) / 180
    let yaw = 0
    if (ids.length === 1) {
      const node = useScene.getState().nodes[ids[0] as AnyNodeId]
      if (node && 'rotation' in node) {
        const r = (node as { rotation?: unknown }).rotation
        if (typeof r === 'number') yaw = r
        else if (Array.isArray(r)) yaw = (r as [number, number, number])[1] ?? 0
      }
    }
    // World-space direction the camera should sit *along* relative to
    // bounds center: in front (object's local +Z under yaw) + a right
    // offset around Y for the 3/4 read.
    const viewAngle = yaw + SIDE_OFFSET_RAD
    const horizontal = distance * Math.cos(ELEVATION_RAD)
    const elevation = distance * Math.sin(ELEVATION_RAD)
    controls.current.setLookAt(
      tempCenter.x + Math.sin(viewAngle) * horizontal,
      tempCenter.y + elevation,
      tempCenter.z + Math.cos(viewAngle) * horizontal,
      tempCenter.x,
      tempCenter.y,
      tempCenter.z,
      true,
    )

    return () => {
      // Cleanup runs on captureMode change *or* unmount. Restore the
      // pre-capture pose only if the controls are still around (during
      // unmount they might be torn down already).
      if (!controls.current) return
      controls.current.setLookAt(
        restorePos.x,
        restorePos.y,
        restorePos.z,
        restoreTarget.x,
        restoreTarget.y,
        restoreTarget.z,
        true,
      )
    }
  }, [captureMode, isFirstPersonMode])

  useEffect(() => {
    const handleNodeCapture = ({ nodeId }: CameraControlEvent) => {
      if (isFirstPersonMode || !controls.current) return

      const position = new Vector3()
      const target = new Vector3()
      controls.current.getPosition(position)
      controls.current.getTarget(target)

      const state = useScene.getState()

      state.updateNode(nodeId, {
        camera: {
          position: [position.x, position.y, position.z],
          target: [target.x, target.y, target.z],
          mode: useViewer.getState().cameraMode,
        },
      })
    }
    const handleNodeView = ({ nodeId }: CameraControlEvent) => {
      if (isFirstPersonMode || !controls.current) return

      const node = useScene.getState().nodes[nodeId]
      if (!node?.camera) return
      const { position, target } = node.camera

      clearPendingFloorplanNavigationPose()
      controls.current.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true,
      )
    }

    const handleTopView = () => {
      if (isFirstPersonMode || !controls.current) return

      const currentPolarAngle = controls.current.polarAngle

      // Toggle: if already near top view (< 0.1 radians ≈ 5.7°), go back to 45°
      // Otherwise, go to top view (0°)
      const targetAngle = currentPolarAngle < 0.1 ? Math.PI / 4 : 0

      clearPendingFloorplanNavigationPose()
      controls.current.rotatePolarTo(targetAngle, true)
    }

    const handleOrbitCW = () => {
      if (isFirstPersonMode || !controls.current) return

      const currentAzimuth = controls.current.azimuthAngle
      const currentPolar = controls.current.polarAngle
      // Round to nearest 90° increment, then rotate 90° clockwise
      const rounded = Math.round(currentAzimuth / (Math.PI / 2)) * (Math.PI / 2)
      const target = rounded - Math.PI / 2

      clearPendingFloorplanNavigationPose()
      controls.current.rotateTo(target, currentPolar, true)
    }

    const handleOrbitCCW = () => {
      if (isFirstPersonMode || !controls.current) return

      const currentAzimuth = controls.current.azimuthAngle
      const currentPolar = controls.current.polarAngle
      // Round to nearest 90° increment, then rotate 90° counter-clockwise
      const rounded = Math.round(currentAzimuth / (Math.PI / 2)) * (Math.PI / 2)
      const target = rounded + Math.PI / 2

      clearPendingFloorplanNavigationPose()
      controls.current.rotateTo(target, currentPolar, true)
    }

    const handleNodeFocus = ({ nodeId }: CameraControlEvent) => {
      focusNode(nodeId)
    }

    const handleFitScene = ({ bounds }: CameraControlFitSceneEvent) => {
      if (isFirstPersonMode || !controls.current || isPreviewMode) return
      if (!bounds) {
        // Restore default framing pose when no bounds were computed.
        clearPendingFloorplanNavigationPose()
        controls.current.setLookAt(20, 20, 20, 0, 0, 0, true)
        return
      }
      const [cx, cz] = bounds.center
      const [w, d] = bounds.size
      // Use the longer horizontal extent to size the orbit radius so the whole
      // footprint sits in view regardless of aspect ratio.
      const maxExtent = Math.max(w, d)
      const distance = Math.max(maxExtent * 1.4, 15)
      const height = Math.max(maxExtent * 0.8, 10)
      clearPendingFloorplanNavigationPose()
      controls.current.setLookAt(cx + distance * 0.7, height, cz + distance * 0.7, cx, 0, cz, true)
    }

    emitter.on('camera-controls:capture', handleNodeCapture)
    emitter.on('camera-controls:focus', handleNodeFocus)
    emitter.on('camera-controls:view', handleNodeView)
    emitter.on('camera-controls:top-view', handleTopView)
    emitter.on('camera-controls:orbit-cw', handleOrbitCW)
    emitter.on('camera-controls:orbit-ccw', handleOrbitCCW)
    emitter.on('camera-controls:fit-scene', handleFitScene)

    return () => {
      emitter.off('camera-controls:capture', handleNodeCapture)
      emitter.off('camera-controls:focus', handleNodeFocus)
      emitter.off('camera-controls:view', handleNodeView)
      emitter.off('camera-controls:top-view', handleTopView)
      emitter.off('camera-controls:orbit-cw', handleOrbitCW)
      emitter.off('camera-controls:orbit-ccw', handleOrbitCCW)
      emitter.off('camera-controls:fit-scene', handleFitScene)
    }
  }, [clearPendingFloorplanNavigationPose, focusNode, isPreviewMode, isFirstPersonMode])

  const onTransitionStart = useCallback(() => {
    cameraDraggingLifecycle.begin()
  }, [cameraDraggingLifecycle])

  const onRest = useCallback(() => {
    cameraDraggingLifecycle.end()
  }, [cameraDraggingLifecycle])

  const onControlEnd = useCallback(() => {
    // A mapped-button tap with zero camera movement never wakes the
    // controls, so no rest/sleep follows — clear the dragging flag on
    // release. While damping is still settling (`active`), rest/sleep
    // clears it instead.
    if (!controls.current?.active) {
      cameraDraggingLifecycle.end()
    }
  }, [cameraDraggingLifecycle])

  // Preset capture mode frames a single subtree (often a 0.3–2m preset),
  // so the default 2m minDistance prevents the user from getting close
  // enough to compose a good thumbnail. Relax the clamp to 0.5m while
  // capturing presets; reset on exit so general editing keeps the looser
  // navigation guardrails.
  const isPresetCapture = captureMode.mode === 'preset'
  const minDistance = isPresetCapture ? 0.5 : 2

  if (isFirstPersonMode) {
    return null
  }

  return (
    <CameraControls
      makeDefault
      maxDistance={100}
      maxPolarAngle={maxPolarAngle}
      minDistance={minDistance}
      minPolarAngle={0}
      mouseButtons={mouseButtons}
      onControlEnd={onControlEnd}
      onControlStart={handleControlStart}
      onUpdate={handleCameraUpdate}
      onRest={onRest}
      onSleep={onRest}
      onTransitionStart={onTransitionStart}
      ref={controls}
      restThreshold={0.01}
      touches={touches}
    />
  )
}
