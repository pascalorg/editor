'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildBoxVentGeometry } from './geometry'
import type { BoxVentNode } from './schema'

/**
 * Translucent ghost of a box vent, used by the placement tool's cursor
 * and the move-tool preview. Builds the geometry through the shared
 * pure builder so the ghost shape stays in lockstep with the committed
 * vent.
 *
 * Raycast is disabled on the mesh — the cursor follows the vent, so
 * leaving raycast active would cause the preview itself to intercept
 * the cursor ray and starve the placement tool of `roof:move` events.
 */
const BoxVentPreview = ({ node, invalid }: { node: BoxVentNode; invalid?: boolean }) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildBoxVentGeometry(node),
    [node.width, node.depth, node.height, node.hoodOverhang, node.style],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: invalid ? INVALID_GHOST_COLOR : 0xff_ff_ff,
        emissive: invalid ? INVALID_GHOST_COLOR : 0x6c_a3_ff,
        emissiveIntensity: 0.18,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true,
        opacity: invalid ? 0.4 : 0.35,
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
          /* disabled — see component-level note */
        }}
      />
      <lineSegments geometry={edgesGeometry} renderOrder={1000}>
        <lineBasicMaterial color={0x6c_a3_ff} depthTest={false} opacity={0.95} transparent />
      </lineSegments>
    </group>
  )
}

export default BoxVentPreview
