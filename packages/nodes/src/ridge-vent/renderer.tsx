'use client'

import {
  type AnyNodeId,
  type RidgeVentNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildRidgeVentGeometry } from './geometry'

// Single white fallback for every style. Paint customisation comes from
// `node.material` / `node.materialPreset` (default: `preset-white`); the
// fallback only fires for legacy nodes that pre-date the schema default
// and shouldn't punish them with style-specific grey/metal that diverges
// from the "default white" the inspector advertises.
const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

/**
 * Ridge vent renderer. Sits along the ridge of a roof-segment — no
 * slope tilt is needed (the ridge IS the high line of the segment), so
 * the transform stack is simply
 *
 *   segment.position → segment.rotation (Y) → vent.position
 *     → vent.rotation (Y) → mesh
 *
 * Mirrors the box-vent renderer otherwise (segment lookup via
 * useScene, live-transform follow for parent drags). Style-specific
 * default materials let unpainted ridge vents read as their material
 * family (matte standard / shingled grey / brushed metal) before the
 * user opens the paint tray.
 */
const RidgeVentRenderer = ({ node }: { node: RidgeVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'ridge-vent', ref)
  const handlers = useNodeEvents(node, 'ridge-vent')

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(() => buildRidgeVentGeometry(node), [
    node.length,
    node.width,
    node.height,
    node.style,
    node.endCaps,
  ])

  useEffect(() => () => geometry.dispose(), [geometry])

  // The preset cache returns materials with `side: FrontSide` (that's
  // what the preset payload encodes). For a thin extruded ridge cap that
  // makes the underside disappear when the camera dips below the eaves
  // — so clone the resolved material and force `DoubleSide` locally
  // without mutating the shared cache entry.
  const material = useMemo(() => {
    const base = node.material
      ? createMaterial(node.material)
      : (createMaterialFromPresetRef(node.materialPreset) ?? defaultMaterial)
    if (base.side === THREE.DoubleSide) return base
    const cloned = base.clone()
    cloned.side = THREE.DoubleSide
    return cloned
  }, [node.material, node.materialPreset])

  if (!segment) return null

  return (
    <group
      position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
      ref={ref}
      rotation-y={node.rotation ?? 0}
      visible={node.visible}
    >
      <mesh
        castShadow
        geometry={geometry}
        material={material}
        name="ridge-vent-surface"
        receiveShadow
        {...handlers}
      />
    </group>
  )
}

export default RidgeVentRenderer
