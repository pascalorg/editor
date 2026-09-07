'use client'

import { useFrame } from '@react-three/fiber'
import { useXRInputSourceStateContext, XRSpace } from '@react-three/xr'
import { useEffect, useRef } from 'react'
import { type Object3D, Vector3 } from 'three'
import { advancePalmGrab, type PalmGrabPose } from '../lib/palm-grab'
import { clearGodScaleHandState, updateGodScaleHandState } from '../store/god-mode-hand-store'

export function GodModeHandControls() {
  const state = useXRInputSourceStateContext('hand')
  const wrist = useRef<Object3D | null>(null)
  const middleFingerTip = useRef<Object3D | null>(null)
  const middleMetacarpal = useRef<Object3D | null>(null)
  const ringMetacarpal = useRef<Object3D | null>(null)
  const ringFingerTip = useRef<Object3D | null>(null)
  const pinkyMetacarpal = useRef<Object3D | null>(null)
  const pinkyFingerTip = useRef<Object3D | null>(null)
  const wristPosition = useRef(new Vector3())
  const middleMetacarpalPosition = useRef(new Vector3())
  const middleFingerPosition = useRef(new Vector3())
  const ringMetacarpalPosition = useRef(new Vector3())
  const ringFingerPosition = useRef(new Vector3())
  const pinkyMetacarpalPosition = useRef(new Vector3())
  const pinkyFingerPosition = useRef(new Vector3())
  const palmGrabPosition = useRef(new Vector3())
  const palmGrabState = useRef({ elapsed: 0, grabbed: false })
  const palmGrabPose = useRef<PalmGrabPose | null>(null)
  const handedness = state.inputSource.handedness

  useEffect(() => () => clearGodScaleHandState(handedness), [handedness])

  useFrame((_, delta) => {
    if (wrist.current?.visible) wrist.current.getWorldPosition(wristPosition.current)
    if (middleMetacarpal.current?.visible) {
      middleMetacarpal.current.getWorldPosition(middleMetacarpalPosition.current)
    }
    if (middleFingerTip.current?.visible) {
      middleFingerTip.current.getWorldPosition(middleFingerPosition.current)
    }
    if (ringMetacarpal.current?.visible) {
      ringMetacarpal.current.getWorldPosition(ringMetacarpalPosition.current)
    }
    if (ringFingerTip.current?.visible) {
      ringFingerTip.current.getWorldPosition(ringFingerPosition.current)
    }
    if (pinkyMetacarpal.current?.visible) {
      pinkyMetacarpal.current.getWorldPosition(pinkyMetacarpalPosition.current)
    }
    if (pinkyFingerTip.current?.visible) {
      pinkyFingerTip.current.getWorldPosition(pinkyFingerPosition.current)
    }

    const tracked = Boolean(
      wrist.current?.visible &&
        middleMetacarpal.current?.visible &&
        middleFingerTip.current?.visible &&
        ringMetacarpal.current?.visible &&
        ringFingerTip.current?.visible &&
        pinkyMetacarpal.current?.visible &&
        pinkyFingerTip.current?.visible,
    )
    palmGrabPose.current ??= {
      middle: { metacarpal: middleMetacarpalPosition.current, tip: middleFingerPosition.current },
      pinky: { metacarpal: pinkyMetacarpalPosition.current, tip: pinkyFingerPosition.current },
      ring: { metacarpal: ringMetacarpalPosition.current, tip: ringFingerPosition.current },
      wrist: wristPosition.current,
    }

    const grabbed = advancePalmGrab(
      palmGrabState.current,
      tracked ? palmGrabPose.current : null,
      delta,
    )
    if (tracked) {
      palmGrabPosition.current
        .copy(middleMetacarpalPosition.current)
        .add(ringMetacarpalPosition.current)
        .multiplyScalar(0.5)
    }
    updateGodScaleHandState(handedness, grabbed, tracked, palmGrabPosition.current)
  })

  return (
    <>
      <XRSpace ref={wrist} space="wrist" />
      <XRSpace ref={middleFingerTip} space="middle-finger-tip" />
      <XRSpace ref={middleMetacarpal} space="middle-finger-metacarpal" />
      <XRSpace ref={ringMetacarpal} space="ring-finger-metacarpal" />
      <XRSpace ref={ringFingerTip} space="ring-finger-tip" />
      <XRSpace ref={pinkyMetacarpal} space="pinky-finger-metacarpal" />
      <XRSpace ref={pinkyFingerTip} space="pinky-finger-tip" />
    </>
  )
}
