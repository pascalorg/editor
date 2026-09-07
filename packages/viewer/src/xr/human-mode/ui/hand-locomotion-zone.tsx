'use client'

import { Text } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { useMemo, useRef } from 'react'
import { DoubleSide, Euler, type Group, Quaternion, Vector3 } from 'three'
import { useStore } from 'zustand'
import { OVERLAY_LAYER } from '../../../lib/layers'
import { useXRPlayerMode, XR_PLAYER_MODES } from '../../mode-switching/store/player-mode'
import { HAND_ZONE_RADIUS } from '../constants/human-mode-constants'
import {
  getHandLocomotionZoneCenter,
  resolveHandControlLabel,
  resolveHandJoystickArrowRotations,
} from '../lib/hand-locomotion'
import { handLocomotionJoystickStore } from '../store/hand-locomotion-joystick'

const ignoreRaycast = () => null
const JOYSTICK_RADIUS = 0.05
const JOYSTICK_ARROW_DISTANCE = 0.033
const JOYSTICK_COLOR = '#03070c'
const ACTIVATION_RING_WIDTH = 0.002

function HandLocomotionJoystick({ handedness }: { handedness: 'left' | 'right' }) {
  const group = useRef<Group | null>(null)
  const origin = useXR((state) => state.origin)
  const parentInverse = useMemo(() => new Quaternion(), [])
  const groundRotation = useMemo(
    () => new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
    [],
  )
  const control = useStore(handLocomotionJoystickStore, (state) => state[handedness])
  const arrows = resolveHandJoystickArrowRotations(handedness)

  useFrame(() => {
    if (!group.current || !origin) return
    parentInverse.copy(origin.quaternion).invert()
    group.current.quaternion.copy(parentInverse).multiply(groundRotation)
  })

  return (
    <group
      name={`hand-${handedness}-joystick`}
      position={control.position}
      ref={group}
      visible={control.active}
    >
      <mesh frustumCulled={false} layers={OVERLAY_LAYER} raycast={ignoreRaycast} renderOrder={1002}>
        <ringGeometry args={[JOYSTICK_RADIUS - 0.002, JOYSTICK_RADIUS, 64]} />
        <meshBasicMaterial
          color={control.state === 'active' ? '#38bdf8' : JOYSTICK_COLOR}
          depthTest={false}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {arrows.map((rotation) => (
        <group key={rotation} rotation={[0, 0, rotation]}>
          <mesh
            frustumCulled={false}
            layers={OVERLAY_LAYER}
            position={[0, JOYSTICK_ARROW_DISTANCE, 0]}
            raycast={ignoreRaycast}
            renderOrder={1002}
          >
            <circleGeometry args={[0.007, 3, Math.PI / 2]} />
            <meshBasicMaterial
              color={JOYSTICK_COLOR}
              depthTest={false}
              depthWrite={false}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function HandActivationZone({ handedness }: { handedness: 'left' | 'right' }) {
  const group = useRef<Group | null>(null)
  const camera = useThree((state) => state.camera)
  const origin = useXR((state) => state.origin)
  const cameraWorld = useMemo(() => new Vector3(), [])
  const anchor = useMemo(() => new Vector3(), [])
  const control = useStore(handLocomotionJoystickStore, (state) => state[handedness])

  useFrame(() => {
    if (!group.current || !origin) return
    camera.getWorldPosition(cameraWorld)
    anchor.copy(cameraWorld)
    origin.worldToLocal(anchor)
    getHandLocomotionZoneCenter(handedness, group.current.position, anchor)
    group.current.quaternion.copy(origin.quaternion).invert()
  })

  const color =
    control.state === 'active' ? '#38bdf8' : control.state === 'ready' ? '#fbbf24' : '#64748b'
  return (
    <group ref={group}>
      <mesh
        layers={OVERLAY_LAYER}
        name={`hand-${handedness}-activation-zone`}
        raycast={ignoreRaycast}
        renderOrder={1000}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[HAND_ZONE_RADIUS - ACTIVATION_RING_WIDTH, HAND_ZONE_RADIUS, 64]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh
        layers={OVERLAY_LAYER}
        name={`hand-${handedness}-activation-zone-fill`}
        raycast={ignoreRaycast}
        renderOrder={999}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[HAND_ZONE_RADIUS - ACTIVATION_RING_WIDTH, 64]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={0.08}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
      <Text
        anchorX="center"
        anchorY="middle"
        color={control.state === 'active' ? '#38bdf8' : '#cbd5e1'}
        fontSize={0.025}
        layers={OVERLAY_LAYER}
        position={[0, 0.01, 0]}
        raycast={ignoreRaycast}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {resolveHandControlLabel(handedness)}
      </Text>
    </group>
  )
}

export function HandLocomotionZone() {
  const mode = useXRPlayerMode((state) => state.mode)
  const hands = useXR((state) =>
    state.inputSourceStates
      .filter(({ type }) => type === 'hand')
      .map(({ inputSource }) => inputSource.handedness),
  )
  if (mode !== XR_PLAYER_MODES.HUMAN) return null
  return (
    <>
      {hands.includes('left') && (
        <>
          <HandActivationZone handedness="left" />
          <HandLocomotionJoystick handedness="left" />
        </>
      )}
      {hands.includes('right') && (
        <>
          <HandActivationZone handedness="right" />
          <HandLocomotionJoystick handedness="right" />
        </>
      )}
    </>
  )
}
