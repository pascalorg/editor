'use client'

import { NORTH_DIRECTION_DEFAULT } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store/use-scene'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import useViewer from '../../store/use-viewer'

function useNorthDirection(): number {
  const nodes = useScene((state) => state.nodes)
  for (const node of Object.values(nodes)) {
    if (node.type === 'site') {
      const dir = (node as { northDirection?: unknown }).northDirection
      return typeof dir === 'number' ? dir : NORTH_DIRECTION_DEFAULT
    }
  }
  return NORTH_DIRECTION_DEFAULT
}

/**
 * Mounts inside the R3F <Canvas>. Reads the camera azimuth every frame,
 * combines it with the scene's northDirection, and pushes the result to
 * useViewer.northBearingDeg so NorthCompassWidget (outside the canvas) can render it.
 */
export function NorthCompassR3F() {
  const { camera } = useThree()
  const northDirection = useNorthDirection()
  const setNorthBearingDeg = useViewer((s) => s.setNorthBearingDeg)

  const _euler = useRef(new THREE.Euler())
  const _quat = useRef(new THREE.Quaternion())
  const _prevDeg = useRef(0)

  useFrame(() => {
    camera.getWorldQuaternion(_quat.current)
    _euler.current.setFromQuaternion(_quat.current, 'YXZ')
    const cameraYawRad = _euler.current.y

    const northFromScreen = -(northDirection - Math.PI / 2 - cameraYawRad)
    const deg = ((northFromScreen * 180) / Math.PI + 360) % 360

    if (Math.abs(_prevDeg.current - deg) > 0.5) {
      _prevDeg.current = deg
      setNorthBearingDeg(deg)
    }
  })

  return null
}
