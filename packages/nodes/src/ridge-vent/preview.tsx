'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildRidgeVentGeometry } from './geometry'
import type { RidgeVentNode } from './schema'

const RidgeVentPreview = ({ node, invalid }: { node: RidgeVentNode; invalid?: boolean }) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildRidgeVentGeometry(node),
    [node.length, node.width, node.height, node.style, node.endCaps],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: invalid ? INVALID_GHOST_COLOR : 0xff_ff_ff,
        emissive: invalid ? INVALID_GHOST_COLOR : 0xff_ff_ff,
        emissiveIntensity: 0.12,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true,
        opacity: invalid ? 0.4 : 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [invalid],
  )

  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry, 25), [geometry])

  useEffect(
    () => () => {
      geometry.dispose()
      edgesGeometry.dispose()
      material.dispose()
    },
    [geometry, edgesGeometry, material],
  )

  return (
    <group rotation-y={node.rotation ?? 0}>
      <mesh
        geometry={geometry}
        material={material}
        raycast={() => {
          /* see box-vent preview note */
        }}
      />
      <lineSegments geometry={edgesGeometry} renderOrder={1000}>
        <lineBasicMaterial color={0x6c_a3_ff} depthTest={false} opacity={0.9} transparent />
      </lineSegments>
    </group>
  )
}

export default RidgeVentPreview
