'use client'

import {
  type AnyNodeId,
  type BoxVentNode,
  type RoofSegmentNode,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildBoxVentGeometry, computeBoxVentSlopeTilt } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

/**
 * Box vent renderer. The vent is parented to a roof-segment in the scene
 * graph, but the registry-era roof-segment renderer doesn't auto-nest
 * children (it's a single mesh with placeholder geometry filled by
 * `RoofSystem`). So this renderer reads the parent segment directly and
 * reproduces the segment-local transform stack manually:
 *
 *   segment.position → segment.rotation (Y) → vent.position
 *     → slope tilt (X) → vent.rotation (Y) → mesh
 *
 * The slope tilt is derived from the segment's roof shape and the vent's
 * local Z — see `computeBoxVentSlopeTilt`. The +Z side of the segment is
 * the down-slope direction, so a positive Z lands on the lower half of
 * the pitch.
 *
 * Live segment drags are honoured by subscribing to `useLiveTransforms`
 * for the parent segment ID — during the segment's move, the override
 * carries the in-progress position/rotation and the vent follows
 * smoothly without waiting for a commit.
 */
const BoxVentRenderer = ({ node }: { node: BoxVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'box-vent', ref)
  const handlers = useNodeEvents(node, 'box-vent')

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  const segmentLiveTransform = useLiveTransforms((state) =>
    node.roofSegmentId ? state.get(node.roofSegmentId as AnyNodeId) : undefined,
  )

  // Effective segment transform: live override during drag, store value
  // otherwise. Matches the legacy `useFollowSegmentDrag` helper without
  // pulling it forward.
  const segmentPosition = segmentLiveTransform?.position ?? segment?.position
  const segmentRotationY = segmentLiveTransform?.rotation ?? segment?.rotation ?? 0

  const geometry = useMemo(() => buildBoxVentGeometry(node), [
    node.width,
    node.depth,
    node.height,
    node.hoodOverhang,
    node.style,
  ])

  useEffect(() => () => geometry.dispose(), [geometry])

  const tiltX = useMemo(
    () => computeBoxVentSlopeTilt(segment, node.position[2] ?? 0),
    [segment, node.position[2]],
  )

  // Paint surface: explicit material wins, then preset, then the cached
  // default. Mirrors the slab / stair / wall pattern.
  const material = useMemo(() => {
    if (node.material) return createMaterial(node.material)
    const preset = createMaterialFromPresetRef(node.materialPreset)
    if (preset) return preset
    return defaultMaterial
  }, [node.material, node.materialPreset])

  if (!segment || !segmentPosition) return null

  return (
    <group position={segmentPosition} ref={ref} rotation-y={segmentRotationY} visible={node.visible}>
      <group position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}>
        <group rotation-x={tiltX}>
          <group rotation-y={node.rotation ?? 0}>
            <mesh
              castShadow
              geometry={geometry}
              material={material}
              name="box-vent-surface"
              receiveShadow
              {...handlers}
            />
          </group>
        </group>
      </group>
    </group>
  )
}

export default BoxVentRenderer
