'use client'

import { type AnyNodeId, getEffectiveNode, type SceneApi, sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { BufferAttribute, Material, Mesh, Object3D } from 'three'
import { poseCabinetMovingParts } from './animation'
import { type CooktopFlameSeed, updateCooktopFlameTube } from './cooktop-flame'
import {
  bumpCabinetRunsNear,
  type CabinetRunFootprint,
  cabinetRunFootprint,
  cabinetRunNeighborSignature,
} from './definition'

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
const CabinetAnimationSystem = ({ sceneApi }: { sceneApi: SceneApi }) => {
  const appliedRef = useRef(new Map<string, number>())
  const lastTubeUpdateRef = useRef(0)
  // Last-seen neighbor-affecting signature per run. A run whose countertop
  // overhang trims against sibling runs never sees a neighbor's move in its
  // own geometryKey, so when a run's signature changes here we bump the
  // adjacency revision on nearby siblings to re-key them.
  const neighborSignaturesRef = useRef(
    new Map<string, { signature: string; footprint: CabinetRunFootprint }>(),
  )

  useFrame(({ clock }) => {
    const applied = appliedRef.current
    const nodes = sceneApi.nodes()

    const signatures = neighborSignaturesRef.current
    const changedFootprints: CabinetRunFootprint[] = []
    const changedIds = new Set<string>()
    const seenRunIds = new Set<string>()
    for (const id of sceneRegistry.byType.cabinet ?? []) {
      const run = nodes[id as AnyNodeId]
      if (run?.type !== 'cabinet') continue
      seenRunIds.add(id)
      const signature = cabinetRunNeighborSignature(run)
      const previous = signatures.get(id)
      if (previous?.signature === signature) continue
      const footprint = cabinetRunFootprint(run, nodes)
      signatures.set(id, { signature, footprint })
      // First sighting is initial mount/load — every run rebuilds then anyway.
      if (!previous) continue
      changedIds.add(id)
      changedFootprints.push(previous.footprint, footprint)
    }
    for (const id of signatures.keys()) {
      if (seenRunIds.has(id)) continue
      const removed = signatures.get(id)!
      signatures.delete(id)
      changedFootprints.push(removed.footprint)
    }
    if (changedFootprints.length > 0) {
      bumpCabinetRunsNear(sceneApi, changedFootprints, changedIds)
    }
    // Throttle the heavy JS flame-tube vertex rebuild to ~30fps; the cheap
    // ring/core/halo pulses stay at the render frame rate.
    const updateTubes = clock.elapsedTime - lastTubeUpdateRef.current >= 1 / 30
    if (updateTubes) lastTubeUpdateRef.current = clock.elapsedTime
    for (const kind of ['cabinet', 'cabinet-module'] as const) {
      for (const id of sceneRegistry.byType[kind]!) {
        const node = nodes[id as AnyNodeId]
        if (!node || (node.type !== 'cabinet' && node.type !== 'cabinet-module')) continue
        // Resolve live overrides so panel-driven open/close animations (which
        // publish transient frames without committing to the store) pose in
        // real time.
        const value = getEffectiveNode(node).operationState ?? 0
        const obj = sceneRegistry.nodes.get(id)
        if (!obj) continue
        if (applied.get(id) !== value) {
          poseCabinetMovingParts(obj, value)
          applied.set(id, value)
        }
        animateCabinetFlames(obj, clock.elapsedTime, updateTubes)
      }
    }
  }, 2)

  return null
}

export default CabinetAnimationSystem
