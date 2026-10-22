'use client'

import { type AnyNodeId, type RoofSegmentNode, useScene } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildCupolaGeometry } from './geometry'
import type { CupolaNode } from './schema'

/**
 * Translucent ghost of a cupola, used by the placement tool's cursor and
 * the move-tool preview. Builds geometry through the shared pure builder so
 * the ghost stays in lockstep with the committed cupola. Raycast disabled
 * so the preview doesn't intercept the cursor ray feeding the tool.
 */
const CupolaPreview = ({ node, invalid }: { node: CupolaNode; invalid?: boolean }) => {
  const segment = useScene((s) =>
    node.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildCupolaGeometry(node, segment),
    [
      node.width,
      node.depth,
      node.height,
      node.roofStyle,
      node.finial,
      node.rotation,
      node.position[0],
      node.position[2],
      segment,
    ],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: invalid ? INVALID_GHOST_COLOR : 0xff_ff_ff,
        emissive: invalid ? INVALID_GHOST_COLOR : 0x6c_a3_ff,
        emissiveIntensity: 0.18,
        roughness: 0.7,
        metalness: 0.1,
        transparent: true,
        opacity: invalid ? 0.4 : 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [invalid],
  )

  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry, 25), [geometry])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => edgesGeometry.dispose(), [edgesGeometry])
  useEffect(() => () => material.dispose(), [material])

  return (
    <group rotation-y={node.rotation ?? 0}>
      <mesh
        layers={EDITOR_LAYER}
        geometry={geometry}
        material={material}
        raycast={() => {
          /* disabled — see component-level note */
        }}
      />
      <lineSegments layers={EDITOR_LAYER} geometry={edgesGeometry} renderOrder={1000}>
        <lineBasicMaterial
          color={invalid ? INVALID_GHOST_COLOR : 0x6c_a3_ff}
          depthTest={false}
          opacity={0.95}
          transparent
        />
      </lineSegments>
    </group>
  )
}

export default CupolaPreview
