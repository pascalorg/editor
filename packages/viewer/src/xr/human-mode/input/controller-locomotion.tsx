'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useXR, useXRInputSourceState } from '@react-three/xr'
import { useRef } from 'react'
import { Vector3 } from 'three'
import { useXRPlayerMode, XR_PLAYER_MODES } from '../../mode-switching/store/player-mode'
import { pulseInputSource } from '../lib/haptics'
import {
  getCameraRelativeRight,
  getControllerThumbstickAxis,
  normalizeMovementVector,
  resolveLocomotionDelta,
  setArtificialMovementSpeed,
} from '../lib/locomotion'
import { rotateOriginAroundCamera, translateOrigin } from '../lib/origin-navigation'
import { resolveSnapTurnDirection, SNAP_TURN_ANGLE, shouldSnapTurn } from '../lib/snap-turn'
import { resolveHumanCollisionTranslation } from '../store/collision-store'
import { useLocomotionSettings } from '../store/locomotion-settings'

export function ControllerLocomotion() {
  const leftController = useXRInputSourceState('controller', 'left')
  const rightController = useXRInputSourceState('controller', 'right')
  const origin = useXR((state) => state.origin)
  const camera = useThree((state) => state.camera)
  const mode = useXRPlayerMode((state) => state.mode)
  const moveSpeed = useLocomotionSettings((state) => state.moveSpeed)
  const turnSensitivity = useLocomotionSettings((state) => state.turnSensitivity)
  const direction = useRef(new Vector3())
  const right = useRef(new Vector3())
  const movement = useRef(new Vector3())
  const resolvedMovement = useRef(new Vector3())
  const playerPosition = useRef(new Vector3())
  const resolvedPlayerPosition = useRef(new Vector3())
  const previousTurnDirection = useRef(0)
  const cameraBeforeTurn = useRef(new Vector3())
  const cameraAfterTurn = useRef(new Vector3())

  useFrame((_, delta) => {
    const x = getControllerThumbstickAxis(leftController, 0)
    const y = getControllerThumbstickAxis(leftController, 1)
    const rightX = getControllerThumbstickAxis(rightController, 0)
    if (mode !== XR_PLAYER_MODES.HUMAN || !origin) {
      setArtificialMovementSpeed(0)
      previousTurnDirection.current = 0
      return
    }

    const locomotionDelta = resolveLocomotionDelta(delta)
    setArtificialMovementSpeed(Math.min(1, Math.hypot(x, y)) * moveSpeed)
    if (Math.max(Math.abs(x), Math.abs(y)) > 0.1) {
      camera.getWorldDirection(direction.current)
      direction.current.y = 0
      direction.current.normalize()
      getCameraRelativeRight(direction.current, right.current)
      const normalized = normalizeMovementVector(x, y)
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
    }

    const turnDirection = resolveSnapTurnDirection(rightX)
    if (shouldSnapTurn(previousTurnDirection.current, turnDirection)) {
      rotateOriginAroundCamera(
        origin,
        camera,
        -turnDirection * SNAP_TURN_ANGLE * turnSensitivity,
        cameraBeforeTurn.current,
        cameraAfterTurn.current,
      )
      pulseInputSource(rightController?.inputSource, 0.25, 35)
    }
    previousTurnDirection.current = turnDirection
  })

  return null
}
