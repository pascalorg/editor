'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildGutterGeometry } from './geometry'
import type { GutterNode } from './schema'

const GutterPreview = ({ node }: { node: GutterNode }) => {
  const geometry = useMemo(
    () => buildGutterGeometry(node),
    [node.length, node.size, node.thickness, node.profile],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xff_ff_ff,
        emissive: 0xff_ff_ff,
        emissiveIntensity: 0.12,
        roughness: 0.7,
        metalness: 0.2,
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
        // See box-vent preview note — never let the preview swallow
        // roof events meant for the placement tool's hit-tester.
        raycast={() => {}}
      />
      <lineSegments geometry={edgesGeometry} renderOrder={1000}>
        <lineBasicMaterial color={0x6c_a3_ff} depthTest={false} opacity={0.9} transparent />
      </lineSegments>
    </group>
  )
}

export default GutterPreview
