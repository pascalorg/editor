'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Object3D } from 'three'

type CabinetPose =
  | { type: 'rotate'; axis: 'x' | 'y' | 'z'; angle: number }
  | { type: 'translate'; axis: 'x' | 'y' | 'z'; distance: number }

function poseCabinet(root: Object3D, openScale: number) {
  root.traverse((obj) => {
    const pose = obj.userData.cabinetPose as CabinetPose | undefined
    if (!pose) return
    if (pose.type === 'rotate') obj.rotation[pose.axis] = pose.angle * openScale
    else obj.position[pose.axis] = pose.distance * openScale
  })
}

/**
 * Poses door hinges / drawer slides stamped with `userData.cabinetPose`
 * directly, so `operationState` changes never trigger a geometry rebuild
 * (it is deliberately absent from the cabinet `geometryKey`s). Builders
 * still bake the current pose at build time; this system only acts when
 * the value drifts from what the mounted group last showed.
 */
const CabinetAnimationSystem = () => {
  const appliedRef = useRef(new Map<string, number>())

  useFrame(() => {
    const applied = appliedRef.current
    const nodes = useScene.getState().nodes
    for (const kind of ['cabinet', 'cabinet-module'] as const) {
      for (const id of sceneRegistry.byType[kind]!) {
        const node = nodes[id as AnyNodeId]
        if (!node || (node.type !== 'cabinet' && node.type !== 'cabinet-module')) continue
        const value = node.operationState ?? 0
        if (applied.get(id) === value) continue
        const obj = sceneRegistry.nodes.get(id)
        if (!obj) continue
        poseCabinet(obj, value)
        applied.set(id, value)
      }
    }
  }, 2)

  return null
}

export default CabinetAnimationSystem
