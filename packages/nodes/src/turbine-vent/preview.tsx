'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildTurbineVentGeometry } from './geometry'
import type { TurbineVentNode } from './schema'

/**
 * Translucent ghost of a turbine vent, used by the placement tool's
 * cursor and the move-tool preview. Builds the combined (non-spinning)
 * geometry through the shared pure builder so the ghost shape stays in
 * lockstep with the committed vent. Raycast is disabled so the preview
 * doesn't intercept the cursor ray feeding the placement tool.
 */
const TurbineVentPreview = ({ node }: { node: TurbineVentNode }) => {
  const geometry = useMemo(
    () => buildTurbineVentGeometry(node),
    [node.style, node.diameter, node.height, node.neckHeight, node.vaneCount, node.baseOverhang],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xff_ff_ff,
        emissive: 0x6c_a3_ff,
        emissiveIntensity: 0.18,
        roughness: 0.6,
        metalness: 0.2,
        transparent: true,
        opacity: 0.35,
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
          /* disabled — see component-level note */
        }}
      />
      <lineSegments geometry={edgesGeometry} renderOrder={1000}>
        <lineBasicMaterial color={0x6c_a3_ff} depthTest={false} opacity={0.95} transparent />
      </lineSegments>
    </group>
  )
}

export default TurbineVentPreview
