import type { CameraControlsImpl } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import useNavigation, { navigationEmitter } from '../store/use-navigation'

const liveActorPosition = new Vector3()
const bufferedActorPosition = new Vector3()
const followFocusPoint = new Vector3()
const followDesiredPosition = new Vector3()
const followDesiredTarget = new Vector3()
const followDefaultViewDirection = new Vector3(0.62, -0.48, 0.62).normalize()
const tempPosition = new Vector3()
const FOLLOW_CAMERA_CLOSE_DISTANCE = 11.5
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

function setDefaultFollowPositionOffset(offset: Vector3) {
  offset.copy(followDefaultViewDirection).multiplyScalar(-FOLLOW_CAMERA_CLOSE_DISTANCE)
}

function isFiniteVector3(vector: Vector3) {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function applyFollowCameraPose(
  controls: CameraControlsImpl,
  position: Vector3,
  target: Vector3,
) {
  if (!(isFiniteVector3(position) && isFiniteVector3(target))) {
    return
  }

  controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
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

export function useNavigationCameraFollow({
  controls,
  isPreviewMode,
  walkthroughMode,
}: {
  controls: RefObject<CameraControlsImpl>
  isPreviewMode: boolean
  walkthroughMode: boolean
}) {
  const actorWorldPosition = useNavigation((state) => state.actorWorldPosition)
  const followRobotEnabled = useNavigation((state) => state.followRobotEnabled)
  const setFollowRobotEnabled = useNavigation((state) => state.setFollowRobotEnabled)
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

  useEffect(() => {
    if (!(followRobotEnabled && (isPreviewMode || walkthroughMode))) {
      return
    }

    setFollowRobotEnabled(false)
  }, [followRobotEnabled, isPreviewMode, setFollowRobotEnabled, walkthroughMode])

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

  useEffect(() => {
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

    navigationEmitter.on('navigation:look-at', handleLookAt)

    return () => {
      navigationEmitter.off('navigation:look-at', handleLookAt)
    }
  }, [controls])

  useEffect(() => {
    const followRig = followRigRef.current
    if (!followRobotEnabled) {
      followRig.initialized = false
      return
    }

    if (!(controls.current && followRig.hasActorTransform)) {
      return
    }

    const delayedActorPosition = sampleBufferedActorPosition(
      followHistoryRef.current,
      performance.now() - FOLLOW_CAMERA_BUFFER_DELAY_MS,
      bufferedActorPosition,
    )
      ? bufferedActorPosition
      : liveActorPosition

    followRig.actorAnchor.copy(delayedActorPosition)
    followFocusPoint.copy(delayedActorPosition).add(FOLLOW_CAMERA_FOCUS_OFFSET)
    setDefaultFollowPositionOffset(followRig.positionOffset)
    followRig.cameraPosition.copy(followFocusPoint).add(followRig.positionOffset)
    followRig.cameraTarget.copy(followFocusPoint)
    followRig.initialized = true
  }, [controls, followRobotEnabled])

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
  }, [controls, followRobotEnabled])

  useFrame((_, delta) => {
    if (!controls.current || !followRobotEnabled || isPreviewMode || walkthroughMode) {
      return
    }

    const followRig = followRigRef.current
    if (!followRig.hasActorTransform) {
      return
    }

    if (!followRig.initialized) {
      followRig.actorAnchor.copy(liveActorPosition)
      followFocusPoint.copy(liveActorPosition).add(FOLLOW_CAMERA_FOCUS_OFFSET)
      setDefaultFollowPositionOffset(followRig.positionOffset)
      followRig.cameraPosition.copy(followFocusPoint).add(followRig.positionOffset)
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
      applyFollowCameraPose(controls.current, followRig.cameraPosition, followRig.cameraTarget)
      return
    }

    followDesiredPosition
      .copy(followRig.actorAnchor)
      .add(FOLLOW_CAMERA_FOCUS_OFFSET)
      .add(followRig.positionOffset)
    followDesiredTarget.copy(followRig.actorAnchor).add(FOLLOW_CAMERA_FOCUS_OFFSET)

    followRig.cameraPosition.copy(followDesiredPosition)
    followRig.cameraTarget.copy(followDesiredTarget)

    applyFollowCameraPose(controls.current, followRig.cameraPosition, followRig.cameraTarget)
  }, 100)
}
