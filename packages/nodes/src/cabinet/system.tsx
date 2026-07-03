'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { BufferAttribute, Material, Mesh, Object3D } from 'three'
import { type CooktopFlameSeed, updateCooktopFlameTube } from './cooktop-flame'

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

function materialWithOpacity(material: Material | Material[] | undefined): Material | null {
  if (!material) return null
  return Array.isArray(material) ? (material[0] ?? null) : material
}

function animateCabinetFlames(root: Object3D, elapsedTime: number, updateTubes: boolean) {
  root.traverse((obj) => {
    const jet = obj.userData.cabinetFlameJet as
      | { seed: CooktopFlameSeed; burnerR: number }
      | undefined
    if (jet) {
      if (!updateTubes) return
      const mesh = obj as Mesh
      const position = mesh.geometry.getAttribute('position') as BufferAttribute
      updateCooktopFlameTube(position.array as Float32Array, elapsedTime, jet.seed, jet.burnerR)
      position.needsUpdate = true
      return
    }

    const pulse = obj.userData.cabinetFlamePulse as
      | { phase: number; amplitude: number; base: number }
      | undefined
    if (pulse) {
      obj.scale.setScalar(pulse.base + pulse.amplitude * Math.sin(elapsedTime * 2 + pulse.phase))
    }

    const materialPulse = obj.userData.cabinetFlameMaterialPulse as
      | { phase: number; amplitude: number; base: number }
      | undefined
    if (!materialPulse) return
    const material = materialWithOpacity((obj as { material?: Material | Material[] }).material)
    if (!material || !('opacity' in material)) return
    material.opacity =
      materialPulse.base +
      materialPulse.amplitude * Math.sin(elapsedTime * 2.3 + materialPulse.phase)
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
  const lastTubeUpdateRef = useRef(0)

  useFrame(({ clock }) => {
    const applied = appliedRef.current
    const nodes = useScene.getState().nodes
    // Throttle the heavy JS flame-tube vertex rebuild to ~30fps; the cheap
    // ring/core/halo pulses stay at the render frame rate.
    const updateTubes = clock.elapsedTime - lastTubeUpdateRef.current >= 1 / 30
    if (updateTubes) lastTubeUpdateRef.current = clock.elapsedTime
    for (const kind of ['cabinet', 'cabinet-module'] as const) {
      for (const id of sceneRegistry.byType[kind]!) {
        const node = nodes[id as AnyNodeId]
        if (!node || (node.type !== 'cabinet' && node.type !== 'cabinet-module')) continue
        const value = node.operationState ?? 0
        const obj = sceneRegistry.nodes.get(id)
        if (!obj) continue
        if (applied.get(id) !== value) {
          poseCabinet(obj, value)
          applied.set(id, value)
        }
        animateCabinetFlames(obj, clock.elapsedTime, updateTubes)
      }
    }
  }, 2)

  return null
}

export default CabinetAnimationSystem
