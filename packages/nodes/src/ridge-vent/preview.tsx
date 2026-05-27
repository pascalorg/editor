'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildRidgeVentGeometry } from './geometry'
import type { RidgeVentNode } from './schema'

const RidgeVentPreview = ({ node }: { node: RidgeVentNode }) => {
  const geometry = useMemo(
    () => buildRidgeVentGeometry(node),
    [node.length, node.width, node.height, node.style, node.endCaps],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xff_ff_ff,
        emissive: 0xff_ff_ff,
        emissiveIntensity: 0.12,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
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
