'use client'

import { useFrame, useThree } from '@react-three/fiber'
import {
  CombinedPointer,
  DefaultXRController,
  DefaultXRHand,
  useXR,
  useXRInputSourceState,
  useXRInputSourceStateContext,
  type XRControllerState,
  XRSpace,
} from '@react-three/xr'
import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { Euler, type Group, type Object3D, Vector3 } from 'three'
import { DistanceAwareRayPointer } from '../../distance-aware-ray-pointer'
import { GOD_ORIGIN_POSITION, GOD_ORIGIN_ROTATION } from '../../god-mode'
import { GodModeHandControls } from '../../god-mode/input/god-mode-hand-controls'
import { GodModeControls } from '../../god-mode/ui/god-mode-controls'
import { HumanModeHandControls } from '../../human-mode/input/hand-locomotion'
import { pulseInputSource } from '../../human-mode/lib/haptics'
import { HumanModeControls } from '../../human-mode/ui/human-mode-controls'
import {
  VisibleXRController,
  VisibleXRHand,
  XRControllerVisual,
  XRHandVisual,
} from '../../input-visuals'
import { DISTANCE_AWARE_RAY_POINTER_OPTIONS } from '../../pointer-cursor'
import { isR3FPointerTarget } from '../../pointer-filter'
import type { ViewerXRStore } from '../../store'
import {
  captureGodSceneTransform,
  resetSceneForHumanScale,
  resolveHumanPointInScene,
  resolveXRHumanOriginTarget,
  restoreGodSceneTransform,
  type SceneTransform,
} from '../lib/scene-scale-transition'
import {
  advanceThumbModeGesture,
  areThumbTipsTouching,
  type ThumbModeGestureState,
} from '../lib/thumb-mode-gesture'
import { useXRPlayerMode, XR_PLAYER_MODES } from '../store/player-mode'

function PlayerModeDefaultHand() {
  return (
    <>
      <DefaultXRHand grabPointer={false} model={false} rayPointer={false} touchPointer={false} />
      <XRHandVisual />
      <CombinedPointer>
        <DistanceAwareRayPointer
          options={{
            ...DISTANCE_AWARE_RAY_POINTER_OPTIONS,
            filter: isR3FPointerTarget,
            rayModel: {
              ...DISTANCE_AWARE_RAY_POINTER_OPTIONS.rayModel,
              maxLength: 0.2,
            },
          }}
        />
      </CombinedPointer>
    </>
  )
}

function PlayerModeHandInput() {
  return (
    <>
      <PlayerModeDefaultHand />
      <GodModeHandControls />
      <HumanModeHandControls />
      <PlayerModeHandThumbInput />
    </>
  )
}

type InputSourceOverlay = ComponentType<{ type: 'controller' | 'hand' }>

function createPlayerModeHandInput(InputSourceOverlay: InputSourceOverlay) {
  return function PlayerModeHandInputWithOverlay() {
    return (
      <>
        <PlayerModeDefaultHand />
        <GodModeHandControls />
        <HumanModeHandControls />
        <PlayerModeHandThumbInput />
        <InputSourceOverlay type="hand" />
      </>
    )
  }
}

function PlayerModeDefaultController() {
  return (
    <>
      <DefaultXRController grabPointer={false} model={false} rayPointer={false} />
      <XRControllerVisual />
      <CombinedPointer>
        <DistanceAwareRayPointer
          options={{
            ...DISTANCE_AWARE_RAY_POINTER_OPTIONS,
            filter: isR3FPointerTarget,
          }}
        />
      </CombinedPointer>
    </>
  )
}

function createPlayerModeControllerInput(InputSourceOverlay?: InputSourceOverlay) {
  return function PlayerModeControllerInputWithOverlay() {
    return (
      <>
        <PlayerModeDefaultController />
        {InputSourceOverlay && <InputSourceOverlay type="controller" />}
      </>
    )
  }
}

type Handedness = 'left' | 'right'

const thumbObjects: Record<Handedness, Object3D | null> = { left: null, right: null }

function PlayerModeHandThumbInput() {
  const state = useXRInputSourceStateContext('hand')
  const handedness = state.inputSource.handedness
  const setThumbObject = useCallback(
    (object: Object3D | null) => {
      if (handedness === 'left' || handedness === 'right') thumbObjects[handedness] = object
    },
    [handedness],
  )

  return <XRSpace ref={setThumbObject} space="thumb-tip" />
}

function PlayerModeHandToggle({ disabled = false }: { disabled?: boolean }) {
  const leftHand = useXRInputSourceState('hand', 'left')
  const rightHand = useXRInputSourceState('hand', 'right')
  const leftThumb = useRef({ position: new Vector3(), visible: false })
  const rightThumb = useRef({ position: new Vector3(), visible: false })
  const gesture = useRef<ThumbModeGestureState>({ elapsed: 0, triggered: false })
  const selectionBlockedGesture = useRef(false)

  useFrame((_, delta) => {
    if (disabled) return
    const leftObject = thumbObjects.left
    const rightObject = thumbObjects.right
    leftThumb.current.visible = leftObject?.visible === true
    rightThumb.current.visible = rightObject?.visible === true
    if (leftThumb.current.visible) leftObject!.getWorldPosition(leftThumb.current.position)
    if (rightThumb.current.visible) rightObject!.getWorldPosition(rightThumb.current.position)

    const selecting =
      leftHand?.inputSource.gamepad?.buttons[0]?.pressed === true ||
      rightHand?.inputSource.gamepad?.buttons[0]?.pressed === true
    const touching = areThumbTipsTouching(leftThumb.current, rightThumb.current)
    if (selecting) selectionBlockedGesture.current = true
    else if (!touching) selectionBlockedGesture.current = false
    if (
      advanceThumbModeGesture(gesture.current, touching && !selectionBlockedGesture.current, delta)
    ) {
      useXRPlayerMode.getState().toggle()
    }
  })

  return null
}

function isModeButtonPressed(controller: XRControllerState | undefined) {
  if (controller?.gamepad?.['y-button']?.state === 'pressed') return true
  return controller?.inputSource.gamepad?.buttons[5]?.pressed === true
}

function PlayerModeControllerToggle() {
  const leftController = useXRInputSourceState('controller', 'left')
  const pressed = useRef(false)

  useFrame(() => {
    const nextPressed = isModeButtonPressed(leftController)
    if (!pressed.current && nextPressed) {
      useXRPlayerMode.getState().toggle()
      pulseInputSource(leftController?.inputSource, 0.25, 35)
    }
    pressed.current = nextPressed
  })
  return null
}

function PlayerModeRig({ sceneRootRef }: { sceneRootRef: React.RefObject<Group | null> }) {
  const camera = useThree((state) => state.camera)
  const origin = useXR((state) => state.origin)
  const mode = useXRPlayerMode((state) => state.mode)
  const previousMode = useRef(mode)
  const transitionActive = useRef(false)
  const godTransform = useRef<SceneTransform | null>(null)
  const cameraWorldPosition = useRef(new Vector3())
  const cameraDirection = useRef(new Vector3())
  const cameraLocalPosition = useRef(new Vector3())
  const humanPoint = useRef(new Vector3())
  const targetPosition = useRef(new Vector3())
  const targetRotation = useRef(new Euler())

  useFrame((_, delta) => {
    const root = sceneRootRef.current
    if (!root || !origin) return

    if (mode !== previousMode.current) {
      if (mode === XR_PLAYER_MODES.HUMAN) {
        godTransform.current = captureGodSceneTransform(root)
        camera.getWorldPosition(cameraWorldPosition.current)
        camera.getWorldDirection(cameraDirection.current)
        resolveHumanPointInScene(
          root,
          cameraWorldPosition.current,
          cameraDirection.current,
          humanPoint.current,
        )
        cameraLocalPosition.current.copy(cameraWorldPosition.current)
        origin.worldToLocal(cameraLocalPosition.current)
        resolveXRHumanOriginTarget(
          humanPoint.current,
          cameraLocalPosition.current,
          targetPosition.current,
        )
        resetSceneForHumanScale(root)
        targetRotation.current.set(0, 0, 0)
      } else {
        restoreGodSceneTransform(root, godTransform.current)
        targetPosition.current.copy(GOD_ORIGIN_POSITION)
        targetRotation.current.copy(GOD_ORIGIN_ROTATION)
      }
      previousMode.current = mode
      transitionActive.current = true
    }

    if (!transitionActive.current) return

    const blend = 1 - Math.exp(-delta * 8)
    origin.position.lerp(targetPosition.current, blend)
    origin.rotation.x += (targetRotation.current.x - origin.rotation.x) * blend
    origin.rotation.y += (targetRotation.current.y - origin.rotation.y) * blend
    origin.rotation.z += (targetRotation.current.z - origin.rotation.z) * blend
    if (origin.position.distanceTo(targetPosition.current) < 0.002) {
      origin.position.copy(targetPosition.current)
      origin.rotation.copy(targetRotation.current)
      transitionActive.current = false
    }
  })

  return null
}

export function PlayerModeScene({
  children,
  inputSourceOverlay,
  store,
}: {
  children: ReactNode
  inputSourceOverlay?: InputSourceOverlay
  store: ViewerXRStore
}) {
  const sceneRootRef = useRef<Group | null>(null)
  const HandInput = useMemo(
    () =>
      inputSourceOverlay ? createPlayerModeHandInput(inputSourceOverlay) : PlayerModeHandInput,
    [inputSourceOverlay],
  )
  const ControllerInput = useMemo(
    () => createPlayerModeControllerInput(inputSourceOverlay),
    [inputSourceOverlay],
  )

  useEffect(() => {
    useXRPlayerMode.getState().setMode(XR_PLAYER_MODES.GOD)
    store.setHand(HandInput)
    store.setController(ControllerInput)
    return () => {
      store.setHand(VisibleXRHand)
      store.setController(VisibleXRController)
      useXRPlayerMode.getState().setMode(XR_PLAYER_MODES.GOD)
    }
  }, [ControllerInput, HandInput, store])

  return (
    <>
      <PlayerModeControllerToggle />
      <PlayerModeHandToggle disabled={inputSourceOverlay != null} />
      <PlayerModeRig sceneRootRef={sceneRootRef} />
      <GodModeControls sceneRootRef={sceneRootRef} />
      <HumanModeControls sceneRootRef={sceneRootRef} />
      <group name="xr-player-scene-root" ref={sceneRootRef}>
        {children}
      </group>
    </>
  )
}
