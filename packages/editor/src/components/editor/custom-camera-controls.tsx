'use client'

import { type CameraControlEvent, emitter, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer, WalkthroughControls, ZONE_LAYER } from '@pascal-app/viewer'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../lib/constants'
import useEditor from '../../store/use-editor'
import useNavigation, { navigationEmitter } from '../../store/use-navigation'

const currentTarget = new Vector3()
const tempBox = new Box3()
const tempCenter = new Vector3()
const tempDelta = new Vector3()
const tempPosition = new Vector3()
const tempSize = new Vector3()
const tempTarget = new Vector3()
const liveActorPosition = new Vector3()
const bufferedActorPosition = new Vector3()
const followFocusPoint = new Vector3()
const followDesiredPosition = new Vector3()
const followDesiredTarget = new Vector3()
const followDefaultViewDirection = new Vector3(-1, -0.45, -1).normalize()
const DEFAULT_MAX_POLAR_ANGLE = Math.PI / 2 - 0.1
const DEBUG_MAX_POLAR_ANGLE = Math.PI - 0.05
const FOLLOW_CAMERA_CLOSE_DISTANCE = 9.6
const FOLLOW_CAMERA_MIN_DISTANCE = 7.2
const FOLLOW_CAMERA_FOCUS_OFFSET = new Vector3(0, 0.55, 0)
const FOLLOW_CAMERA_BUFFER_DELAY_MS = 800
const FOLLOW_CAMERA_HISTORY_RETENTION_MS = 3000
const FOLLOW_CAMERA_MANUAL_OVERRIDE_MS = 160
const FOLLOW_CAMERA_MANUAL_UPDATE_EPSILON = 0.000001
const FOLLOW_CAMERA_ACTOR_SMOOTHING = 5

type FollowHistorySample = {
  position: Vector3
  timestampMs: number
}

type FollowRigState = {
  actorAnchor: Vector3
  cameraPosition: Vector3
  cameraTarget: Vector3
  hasActorTransform: boolean
  initialized: boolean
  positionOffset: Vector3
}

function getDampingFactor(lambda: number, delta: number) {
  return 1 - Math.exp(-lambda * delta)
}

function normalizeFollowPositionOffset(offset: Vector3) {
  const offsetLength = offset.length()
  if (offsetLength <= Number.EPSILON) {
    offset.copy(followDefaultViewDirection).multiplyScalar(-FOLLOW_CAMERA_CLOSE_DISTANCE)
    return
  }

  if (offsetLength < FOLLOW_CAMERA_MIN_DISTANCE) {
    offset.multiplyScalar(FOLLOW_CAMERA_MIN_DISTANCE / offsetLength)
  }
}

function sampleBufferedActorPosition(
  history: FollowHistorySample[],
  targetTimestampMs: number,
  out: Vector3,
) {
  if (history.length === 0) {
    return false
  }

  const oldestSample = history[0]
  const newestSample = history[history.length - 1]
  if (!(oldestSample && newestSample)) {
    return false
  }

  if (targetTimestampMs <= oldestSample.timestampMs) {
    out.copy(oldestSample.position)
    return true
  }

  if (targetTimestampMs >= newestSample.timestampMs) {
    out.copy(newestSample.position)
    return true
  }

  for (let index = 1; index < history.length; index += 1) {
    const nextSample = history[index]
    const previousSample = history[index - 1]
    if (!(nextSample && previousSample)) {
      continue
    }

    if (targetTimestampMs > nextSample.timestampMs) {
      continue
    }

    const sampleSpan = nextSample.timestampMs - previousSample.timestampMs
    const alpha =
      sampleSpan <= Number.EPSILON
        ? 1
        : (targetTimestampMs - previousSample.timestampMs) / sampleSpan
    out.copy(previousSample.position).lerp(nextSample.position, alpha)
    return true
  }

  out.copy(newestSample.position)
  return true
}

export const CustomCameraControls = () => {
  const controls = useRef<CameraControlsImpl>(null!)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const actorAvailable = useNavigation((s) => s.actorAvailable)
  const actorWorldPosition = useNavigation((s) => s.actorWorldPosition)
  const followRobotEnabled = useNavigation((s) => s.followRobotEnabled)
  const setFollowRobotEnabled = useNavigation((s) => s.setFollowRobotEnabled)
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const allowUndergroundCamera = useEditor((s) => s.allowUndergroundCamera)
  const selection = useViewer((s) => s.selection)
  const currentLevelId = selection.levelId
  const firstLoad = useRef(true)
  const followHistoryRef = useRef<FollowHistorySample[]>([])
  const followInteractionActiveRef = useRef(false)
  const followManualAdjustmentUntilRef = useRef(0)
  const followRigRef = useRef<FollowRigState>({
    actorAnchor: new Vector3(),
    cameraPosition: new Vector3(),
    cameraTarget: new Vector3(),
    hasActorTransform: false,
    initialized: false,
    positionOffset: new Vector3(6.8, 4.87, 6.8),
  })
  const maxPolarAngle =
    !isPreviewMode && allowUndergroundCamera ? DEBUG_MAX_POLAR_ANGLE : DEFAULT_MAX_POLAR_ANGLE

  const camera = useThree((state) => state.camera)
  const raycaster = useThree((state) => state.raycaster)
  useEffect(() => {
    camera.layers.enable(EDITOR_LAYER)
    raycaster.layers.enable(EDITOR_LAYER)
    raycaster.layers.enable(ZONE_LAYER)
  }, [camera, raycaster])

  useEffect(() => {
    if (isPreviewMode) return // Preview mode uses auto-navigate instead
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
      controls.current.setLookAt(20, 20, 20, 0, 0, 0, true)
    }
    controls.current.getTarget(currentTarget)
    controls.current.moveTo(currentTarget.x, targetY, currentTarget.z, true)
  }, [currentLevelId, isPreviewMode])

  useEffect(() => {
    if (!controls.current) return

    controls.current.maxPolarAngle = maxPolarAngle
    controls.current.minPolarAngle = 0

    if (controls.current.polarAngle > maxPolarAngle) {
      controls.current.rotateTo(controls.current.azimuthAngle, maxPolarAngle, true)
    }
  }, [maxPolarAngle])

  useEffect(() => {
    if (!(followRobotEnabled && (isPreviewMode || walkthroughMode || !actorAvailable))) {
      return
    }

    setFollowRobotEnabled(false)
  }, [actorAvailable, followRobotEnabled, isPreviewMode, setFollowRobotEnabled, walkthroughMode])

  useEffect(() => {
    if (!followRobotEnabled) {
      followHistoryRef.current.length = 0
      followRigRef.current.hasActorTransform = false
      followRigRef.current.initialized = false
      return
    }

    if (actorWorldPosition) {
      liveActorPosition.set(actorWorldPosition[0], actorWorldPosition[1], actorWorldPosition[2])
      followHistoryRef.current = [
        {
          position: liveActorPosition.clone(),
          timestampMs: performance.now(),
        },
      ]
      followRigRef.current.hasActorTransform = true
    }

    const handleActorTransform = (event: {
      moving: boolean
      position: [number, number, number] | null
      rotationY: number
    }) => {
      const followRig = followRigRef.current
      const followHistory = followHistoryRef.current

      if (!event.position) {
        followHistory.length = 0
        followRig.hasActorTransform = false
        followRig.initialized = false
        return
      }

      liveActorPosition.set(event.position[0], event.position[1], event.position[2])
      followHistory.push({
        position: liveActorPosition.clone(),
        timestampMs: performance.now(),
      })

      while (
        followHistory.length > 1 &&
        followHistory[0] &&
        followHistory[0].timestampMs < performance.now() - FOLLOW_CAMERA_HISTORY_RETENTION_MS
      ) {
        followHistory.shift()
      }

      followRig.hasActorTransform = true
    }

    navigationEmitter.on('navigation:actor-transform', handleActorTransform)

    return () => {
      navigationEmitter.off('navigation:actor-transform', handleActorTransform)
    }
  }, [actorWorldPosition, followRobotEnabled])

  const focusNode = useCallback(
    (nodeId: string) => {
      if (isPreviewMode || !controls.current) return

      sceneRegistry.getWorldBounds(nodeId, tempBox)
      if (tempBox.isEmpty()) return

      tempBox.getCenter(tempCenter)
      controls.current.getPosition(tempPosition)
      controls.current.getTarget(tempTarget)
      tempDelta.copy(tempCenter).sub(tempTarget)

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
    [isPreviewMode],
  )

  // Configure mouse buttons based on control mode and camera mode
  const cameraMode = useViewer((state) => state.cameraMode)
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

  useEffect(() => {
    const keyState = {
      shiftRight: false,
      shiftLeft: false,
      controlRight: false,
      controlLeft: false,
      space: false,
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
      if (event.code === 'Space') {
        keyState.space = true
        document.body.style.cursor = 'grab'
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
      if (event.code === 'Space') {
        keyState.space = false
        document.body.style.cursor = ''
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

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    updateConfig()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [cameraMode, isPreviewMode])

  // Preview mode: auto-navigate camera to selected node (viewer behavior)
  const previewTargetNodeId = isPreviewMode
    ? (selection.zoneId ?? selection.levelId ?? selection.buildingId)
    : null

  useEffect(() => {
    if (!(isPreviewMode && controls.current)) return

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
    sceneRegistry.getWorldBounds(previewTargetNodeId, tempBox)
    if (tempBox.isEmpty()) return
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
  }, [isPreviewMode, previewTargetNodeId])

  useEffect(() => {
    const handleNodeCapture = ({ nodeId }: CameraControlEvent) => {
      if (!controls.current) return

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
      if (!controls.current) return

      const node = useScene.getState().nodes[nodeId]
      if (!node?.camera) return
      const { position, target } = node.camera

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

    const handleNodeFocus = ({ nodeId }: CameraControlEvent) => {
      focusNode(nodeId)
    }

    const handleLookAt = (event: {
      position: [number, number, number]
      target: [number, number, number]
    }) => {
      if (!controls.current) return

      const { position, target } = event

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

    emitter.on('camera-controls:capture', handleNodeCapture)
    emitter.on('camera-controls:focus', handleNodeFocus)
    emitter.on('camera-controls:view', handleNodeView)
    emitter.on('camera-controls:top-view', handleTopView)
    emitter.on('camera-controls:orbit-cw', handleOrbitCW)
    emitter.on('camera-controls:orbit-ccw', handleOrbitCCW)
    navigationEmitter.on('navigation:look-at', handleLookAt)

    return () => {
      emitter.off('camera-controls:capture', handleNodeCapture)
      emitter.off('camera-controls:focus', handleNodeFocus)
      emitter.off('camera-controls:view', handleNodeView)
      emitter.off('camera-controls:top-view', handleTopView)
      emitter.off('camera-controls:orbit-cw', handleOrbitCW)
      emitter.off('camera-controls:orbit-ccw', handleOrbitCCW)
      navigationEmitter.off('navigation:look-at', handleLookAt)
    }
  }, [focusNode])

  useEffect(() => {
    const followRig = followRigRef.current
    if (!followRobotEnabled) {
      followRig.initialized = false
      return
    }

    if (!(controls.current && followRig.hasActorTransform)) {
      return
    }

    controls.current.getPosition(tempPosition)
    controls.current.getTarget(tempTarget)

    const delayedActorPosition = sampleBufferedActorPosition(
      followHistoryRef.current,
      performance.now() - FOLLOW_CAMERA_BUFFER_DELAY_MS,
      bufferedActorPosition,
    )
      ? bufferedActorPosition
      : liveActorPosition

    followRig.actorAnchor.copy(delayedActorPosition)
    followRig.cameraPosition.copy(tempPosition)
    followFocusPoint.copy(delayedActorPosition).add(FOLLOW_CAMERA_FOCUS_OFFSET)
    followRig.positionOffset.copy(tempPosition).sub(followFocusPoint)
    normalizeFollowPositionOffset(followRig.positionOffset)
    followRig.cameraTarget.copy(followFocusPoint)
    followRig.initialized = true
  }, [followRobotEnabled])

  useEffect(() => {
    const currentControls = controls.current
    if (!currentControls) return

    const syncFollowRigFromControls = () => {
      if (!(followRobotEnabled && currentControls && followRigRef.current.hasActorTransform)) {
        return
      }

      currentControls.getPosition(tempPosition)
      followFocusPoint.copy(followRigRef.current.actorAnchor).add(FOLLOW_CAMERA_FOCUS_OFFSET)
      followRigRef.current.positionOffset.copy(tempPosition).sub(followFocusPoint)
      normalizeFollowPositionOffset(followRigRef.current.positionOffset)
      followRigRef.current.cameraPosition.copy(tempPosition)
      followRigRef.current.cameraTarget.copy(followFocusPoint)
    }

    const handleControlStart = () => {
      followInteractionActiveRef.current = true
    }

    const handleControlEnd = () => {
      followInteractionActiveRef.current = false
      followManualAdjustmentUntilRef.current = performance.now() + FOLLOW_CAMERA_MANUAL_OVERRIDE_MS
      syncFollowRigFromControls()
    }

    const handleUpdate = () => {
      if (!(followRobotEnabled && currentControls && followRigRef.current.hasActorTransform)) {
        return
      }

      currentControls.getPosition(tempPosition)
      followFocusPoint.copy(followRigRef.current.actorAnchor).add(FOLLOW_CAMERA_FOCUS_OFFSET)

      const isExternalUpdate =
        tempPosition.distanceToSquared(followRigRef.current.cameraPosition) >
          FOLLOW_CAMERA_MANUAL_UPDATE_EPSILON ||
        followFocusPoint.distanceToSquared(followRigRef.current.cameraTarget) >
          FOLLOW_CAMERA_MANUAL_UPDATE_EPSILON

      if (!isExternalUpdate) {
        return
      }

      followManualAdjustmentUntilRef.current = performance.now() + FOLLOW_CAMERA_MANUAL_OVERRIDE_MS
      followRigRef.current.positionOffset.copy(tempPosition).sub(followFocusPoint)
      normalizeFollowPositionOffset(followRigRef.current.positionOffset)
      followRigRef.current.cameraPosition.copy(tempPosition)
      followRigRef.current.cameraTarget.copy(followFocusPoint)
    }

    currentControls.addEventListener('controlstart', handleControlStart)
    currentControls.addEventListener('controlend', handleControlEnd)
    currentControls.addEventListener('update', handleUpdate)

    return () => {
      currentControls.removeEventListener('controlstart', handleControlStart)
      currentControls.removeEventListener('controlend', handleControlEnd)
      currentControls.removeEventListener('update', handleUpdate)
    }
  }, [followRobotEnabled])

  useFrame((_, delta) => {
    if (!controls.current || !followRobotEnabled || isPreviewMode || walkthroughMode) {
      return
    }

    const followRig = followRigRef.current
    if (!followRig.hasActorTransform) {
      return
    }

    if (!followRig.initialized) {
      controls.current.getPosition(tempPosition)
      followRig.actorAnchor.copy(liveActorPosition)
      followFocusPoint.copy(liveActorPosition).add(FOLLOW_CAMERA_FOCUS_OFFSET)
      followRig.cameraPosition.copy(tempPosition)
      followRig.positionOffset.copy(tempPosition).sub(followFocusPoint)
      normalizeFollowPositionOffset(followRig.positionOffset)
      followRig.cameraTarget.copy(followFocusPoint)
      followRig.initialized = true
    }

    const actorFactor = getDampingFactor(FOLLOW_CAMERA_ACTOR_SMOOTHING, delta)
    const delayedActorPosition = sampleBufferedActorPosition(
      followHistoryRef.current,
      performance.now() - FOLLOW_CAMERA_BUFFER_DELAY_MS,
      bufferedActorPosition,
    )
      ? bufferedActorPosition
      : liveActorPosition

    followRig.actorAnchor.lerp(delayedActorPosition, actorFactor)
    const manualAdjustmentActive =
      followInteractionActiveRef.current ||
      performance.now() < followManualAdjustmentUntilRef.current

    if (manualAdjustmentActive) {
      controls.current.getPosition(tempPosition)
      followDesiredTarget.copy(followRig.actorAnchor).add(FOLLOW_CAMERA_FOCUS_OFFSET)
      followRig.positionOffset.copy(tempPosition).sub(followDesiredTarget)
      normalizeFollowPositionOffset(followRig.positionOffset)
      followRig.cameraPosition.copy(tempPosition)
      followRig.cameraTarget.copy(followDesiredTarget)
      controls.current.setLookAt(
        followRig.cameraPosition.x,
        followRig.cameraPosition.y,
        followRig.cameraPosition.z,
        followRig.cameraTarget.x,
        followRig.cameraTarget.y,
        followRig.cameraTarget.z,
        false,
      )
      return
    }

    followDesiredPosition
      .copy(followRig.actorAnchor)
      .add(FOLLOW_CAMERA_FOCUS_OFFSET)
      .add(followRig.positionOffset)
    followDesiredTarget.copy(followRig.actorAnchor).add(FOLLOW_CAMERA_FOCUS_OFFSET)

    followRig.cameraPosition.copy(followDesiredPosition)
    followRig.cameraTarget.copy(followDesiredTarget)

    controls.current.setLookAt(
      followRig.cameraPosition.x,
      followRig.cameraPosition.y,
      followRig.cameraPosition.z,
      followRig.cameraTarget.x,
      followRig.cameraTarget.y,
      followRig.cameraTarget.z,
      false,
    )
  })

  const onTransitionStart = useCallback(() => {
    useViewer.getState().setCameraDragging(true)
  }, [])

  const onRest = useCallback(() => {
    useViewer.getState().setCameraDragging(false)
  }, [])

  if (walkthroughMode) {
    return <WalkthroughControls />
  }

  return (
    <CameraControls
      makeDefault
      maxDistance={100}
      maxPolarAngle={maxPolarAngle}
      minDistance={10}
      minPolarAngle={0}
      mouseButtons={mouseButtons}
      onRest={onRest}
      onSleep={onRest}
      onTransitionStart={onTransitionStart}
      ref={controls}
      restThreshold={0.01}
    />
  )
}
