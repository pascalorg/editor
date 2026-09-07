'use client'

import {
  DefaultXRController,
  DefaultXRHand,
  useXRInputSourceStateContext,
  XRSpace,
} from '@react-three/xr'
import { OVERLAY_LAYER } from '../lib/layers'

const HAND_JOINTS: readonly XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
]

export function XRControllerVisual() {
  const state = useXRInputSourceStateContext('controller')
  const accent = state.inputSource.handedness === 'left' ? '#38bdf8' : '#fb923c'

  return (
    <group rotation={[Math.PI / 10, 0, 0]}>
      <mesh
        frustumCulled={false}
        layers={OVERLAY_LAYER}
        position={[0, -0.055, 0.025]}
        renderOrder={1005}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <capsuleGeometry args={[0.032, 0.1, 8, 16]} />
        <meshBasicMaterial color="#27272a" depthTest={false} />
      </mesh>
      <mesh
        frustumCulled={false}
        layers={OVERLAY_LAYER}
        position={[0, 0.02, -0.006]}
        renderOrder={1005}
        scale={[1, 0.42, 1.25]}
      >
        <sphereGeometry args={[0.052, 20, 12]} />
        <meshBasicMaterial color="#e4e4e7" depthTest={false} />
      </mesh>
      <mesh
        frustumCulled={false}
        layers={OVERLAY_LAYER}
        position={[0, 0.039, -0.032]}
        renderOrder={1006}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.052, 0.008, 10, 24]} />
        <meshBasicMaterial color={accent} depthTest={false} />
      </mesh>
      <mesh
        frustumCulled={false}
        layers={OVERLAY_LAYER}
        position={[-0.017, 0.06, -0.005]}
        renderOrder={1006}
      >
        <sphereGeometry args={[0.01, 12, 8]} />
        <meshBasicMaterial color={accent} depthTest={false} />
      </mesh>
      <mesh
        frustumCulled={false}
        layers={OVERLAY_LAYER}
        position={[0.017, 0.06, -0.005]}
        renderOrder={1006}
      >
        <sphereGeometry args={[0.01, 12, 8]} />
        <meshBasicMaterial color="#52525b" depthTest={false} />
      </mesh>
    </group>
  )
}

export function XRHandVisual() {
  const state = useXRInputSourceStateContext('hand')
  const color = state.inputSource.handedness === 'left' ? '#bae6fd' : '#fed7aa'
  const side = state.inputSource.handedness === 'left' ? -1 : 1

  return (
    <>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh
          frustumCulled={false}
          layers={OVERLAY_LAYER}
          position={[0, 0, 0.025]}
          renderOrder={1005}
          scale={[0.075, 0.018, 0.09]}
        >
          <boxGeometry />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
        {[-0.045, -0.015, 0.015, 0.045].map((x, index) => (
          <mesh
            key={x}
            frustumCulled={false}
            layers={OVERLAY_LAYER}
            position={[x, 0, -0.055 - Math.abs(index - 1.5) * 0.008]}
            renderOrder={1005}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <capsuleGeometry args={[0.012, 0.09 - Math.abs(index - 1.5) * 0.012, 8, 12]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        ))}
        <mesh
          frustumCulled={false}
          layers={OVERLAY_LAYER}
          position={[side * 0.082, 0, 0.01]}
          renderOrder={1005}
          rotation={[Math.PI / 2, 0, side * 0.75]}
        >
          <capsuleGeometry args={[0.014, 0.065, 8, 12]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      </group>
      {HAND_JOINTS.map((joint) => (
        <XRSpace key={joint} space={joint}>
          <mesh
            frustumCulled={false}
            layers={OVERLAY_LAYER}
            renderOrder={1006}
            scale={joint === 'wrist' ? [1.8, 1.15, 0.7] : 1}
          >
            <sphereGeometry args={[joint === 'wrist' ? 0.022 : 0.009, 12, 8]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        </XRSpace>
      ))}
    </>
  )
}

export function VisibleXRController() {
  return (
    <>
      <DefaultXRController model={false} />
      <XRControllerVisual />
    </>
  )
}

export function VisibleXRHand() {
  return (
    <>
      <DefaultXRHand model={false} />
      <XRHandVisual />
    </>
  )
}

export { HAND_JOINTS }
