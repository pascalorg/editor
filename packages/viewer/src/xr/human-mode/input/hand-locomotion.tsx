'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useXR, useXRInputSourceStateContext, XRSpace } from '@react-three/xr'
import { useEffect, useRef } from 'react'
import { type Object3D, Vector3 } from 'three'
import { useXRPlayerMode, XR_PLAYER_MODES } from '../../mode-switching/store/player-mode'
import {
  getHandLocomotionZoneCenter,
  isInsideHandLocomotionZone,
  normalizeHandLocomotionOffset,
  resolveHandPinching,
  resolveHandTurnDelta,
} from '../lib/hand-locomotion'
import { isPalmFacingUp } from '../lib/hand-pose'
import { pulseInputSource } from '../lib/haptics'
import {
  getCameraRelativeRight,
  normalizeMovementVector,
  resolveLocomotionDelta,
  setArtificialMovementSpeed,
} from '../lib/locomotion'
import { rotateOriginAroundCamera, translateOrigin } from '../lib/origin-navigation'
import { resolveHumanCollisionTranslation } from '../store/collision-store'
import {
  hideHandLocomotionJoystick,
  setHandLocomotionState,
  showHandLocomotionJoystick,
} from '../store/hand-locomotion-joystick'
import { useLocomotionSettings } from '../store/locomotion-settings'

const LOCOMOTION_HAND = 'left'
const TURN_HAND = 'right'

export function HumanModeHandControls() {
  const state = useXRInputSourceStateContext('hand')
  const origin = useXR((xrState) => xrState.origin)
  const camera = useThree((threeState) => threeState.camera)
  const mode = useXRPlayerMode((playerState) => playerState.mode)
  const moveSpeed = useLocomotionSettings((settings) => settings.moveSpeed)
  const turnSensitivity = useLocomotionSettings((settings) => settings.turnSensitivity)
  const indexTip = useRef<Object3D | null>(null)
  const thumbTip = useRef<Object3D | null>(null)
  const middleTip = useRef<Object3D | null>(null)
  const wrist = useRef<Object3D | null>(null)
  const indexMetacarpal = useRef<Object3D | null>(null)
  const pinkyMetacarpal = useRef<Object3D | null>(null)
  const indexPosition = useRef(new Vector3())
  const thumbPosition = useRef(new Vector3())
  const middlePosition = useRef(new Vector3())
  const wristPosition = useRef(new Vector3())
  const indexMetacarpalPosition = useRef(new Vector3())
  const pinkyMetacarpalPosition = useRef(new Vector3())
  const localHandPosition = useRef(new Vector3())
  const cameraLocalPosition = useRef(new Vector3())
  const zoneCenter = useRef(new Vector3())
  const pinchOrigin = useRef(new Vector3())
  const direction = useRef(new Vector3())
  const right = useRef(new Vector3())
  const movement = useRef(new Vector3())
  const resolvedMovement = useRef(new Vector3())
  const playerPosition = useRef(new Vector3())
  const resolvedPlayerPosition = useRef(new Vector3())
  const cameraBeforeTurn = useRef(new Vector3())
  const cameraAfterTurn = useRef(new Vector3())
  const pinching = useRef(false)
  const active = useRef(false)
  const controlOriginSet = useRef(false)
  const controlState = useRef<'idle' | 'ready'>('idle')
  const handedness = state.inputSource.handedness

  useEffect(
    () => () => {
      if (handedness === 'left' || handedness === 'right') {
        hideHandLocomotionJoystick(handedness)
      }
      if (handedness === LOCOMOTION_HAND) setArtificialMovementSpeed(0)
    },
    [handedness],
  )

  useFrame((_, delta) => {
    if (handedness !== 'left' && handedness !== 'right') return
    const tracked = Boolean(
      indexTip.current?.visible &&
        thumbTip.current?.visible &&
        middleTip.current?.visible &&
        wrist.current?.visible &&
        indexMetacarpal.current?.visible &&
        pinkyMetacarpal.current?.visible,
    )
    if (tracked) {
      indexTip.current!.getWorldPosition(indexPosition.current)
      thumbTip.current!.getWorldPosition(thumbPosition.current)
      middleTip.current!.getWorldPosition(middlePosition.current)
      wrist.current!.getWorldPosition(wristPosition.current)
      indexMetacarpal.current!.getWorldPosition(indexMetacarpalPosition.current)
      pinkyMetacarpal.current!.getWorldPosition(pinkyMetacarpalPosition.current)
    }
    const nextPinching = resolveHandPinching(
      pinching.current,
      tracked ? thumbPosition.current.distanceTo(middlePosition.current) : Number.POSITIVE_INFINITY,
    )
    pinching.current = nextPinching

    if (mode !== XR_PLAYER_MODES.HUMAN || !origin || !tracked) {
      active.current = false
      controlOriginSet.current = false
      hideHandLocomotionJoystick(handedness)
      if (handedness === LOCOMOTION_HAND) setArtificialMovementSpeed(0)
      return
    }

    const palmUp = isPalmFacingUp(
      wristPosition.current,
      indexMetacarpalPosition.current,
      pinkyMetacarpalPosition.current,
      handedness,
    )
    localHandPosition.current.copy(indexPosition.current)
    origin.worldToLocal(localHandPosition.current)
    camera.getWorldPosition(cameraLocalPosition.current)
    origin.worldToLocal(cameraLocalPosition.current)
    getHandLocomotionZoneCenter(handedness, zoneCenter.current, cameraLocalPosition.current)
    const insideZone =
      palmUp &&
      isInsideHandLocomotionZone(localHandPosition.current, handedness, cameraLocalPosition.current)
    const nextState = insideZone ? 'ready' : 'idle'
    if (controlState.current !== nextState && !active.current) {
      controlState.current = nextState
      setHandLocomotionState(handedness, nextState, zoneCenter.current)
    }

    if (!pinching.current || !palmUp) {
      active.current = false
      controlOriginSet.current = false
      hideHandLocomotionJoystick(handedness)
      if (handedness === LOCOMOTION_HAND) setArtificialMovementSpeed(0)
      return
    }
    if (!active.current && insideZone) {
      active.current = true
      pulseInputSource(state.inputSource, 0.2, 35)
    }
    if (!active.current) return
    if (!controlOriginSet.current) {
      pinchOrigin.current.copy(zoneCenter.current)
      controlOriginSet.current = true
      showHandLocomotionJoystick(pinchOrigin.current, handedness)
      return
    }

    const locomotionDelta = resolveLocomotionDelta(delta)
    if (handedness === TURN_HAND) {
      const turnDelta =
        resolveHandTurnDelta(localHandPosition.current.x - pinchOrigin.current.x, locomotionDelta) *
        turnSensitivity
      if (turnDelta !== 0) {
        rotateOriginAroundCamera(
          origin,
          camera,
          turnDelta,
          cameraBeforeTurn.current,
          cameraAfterTurn.current,
        )
      }
      return
    }

    const inputX = normalizeHandLocomotionOffset(
      localHandPosition.current.x - pinchOrigin.current.x,
    )
    const inputZ = normalizeHandLocomotionOffset(
      localHandPosition.current.z - pinchOrigin.current.z,
    )
    setArtificialMovementSpeed(Math.min(1, Math.hypot(inputX, inputZ)) * moveSpeed)
    if (inputX === 0 && inputZ === 0) return
    camera.getWorldDirection(direction.current)
    direction.current.y = 0
    direction.current.normalize()
    getCameraRelativeRight(direction.current, right.current)
    const normalized = normalizeMovementVector(inputX, inputZ)
    movement.current.copy(right.current).multiplyScalar(normalized.x)
    movement.current.addScaledVector(direction.current, -normalized.z)
    movement.current.multiplyScalar(moveSpeed * locomotionDelta)
    camera.getWorldPosition(playerPosition.current)
    resolveHumanCollisionTranslation(
      playerPosition.current,
      movement.current,
      resolvedMovement.current,
    )
    translateOrigin(
      origin,
      resolvedMovement.current,
      playerPosition.current,
      resolvedPlayerPosition.current,
    )
  })

  return (
    <>
      <XRSpace ref={indexTip} space="index-finger-tip" />
      <XRSpace ref={thumbTip} space="thumb-tip" />
      <XRSpace ref={middleTip} space="middle-finger-tip" />
      <XRSpace ref={wrist} space="wrist" />
      <XRSpace ref={indexMetacarpal} space="index-finger-metacarpal" />
      <XRSpace ref={pinkyMetacarpal} space="pinky-finger-metacarpal" />
    </>
  )
}
