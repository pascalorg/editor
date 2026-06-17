'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildGutterGeometry } from './geometry'
import type { GutterNode } from './schema'

/**
 * Translucent ghost of a gutter — built from the same `buildGutterGeometry`
 * the renderer commits, so the shape on screen during placement is the
 * shape that lands on click.
 *
 * No internal transform wrapper. Callers (placement tool + move tool)
 * mirror the GutterRenderer's transform chain around this component
 * (roof → segment → snap), so the ghost shares one bulletproof chain
 * with the committed mesh instead of a flattened-yaw shortcut that can
 * drift in edge cases.
 *
 * FrontSide matches the renderer; DoubleSide would render the inside
 * of the trough walls and visually thicken the ghost relative to the
 * placed gutter.
 */
const GutterPreview = ({ node, invalid }: { node: GutterNode; invalid?: boolean }) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildGutterGeometry(node),
    [
      node.length,
      node.size,
      node.thickness,
      node.profile,
      node.endCapLeft,
      node.endCapRight,
      node.hangerStyle,
      node.hangerSpacing,
      JSON.stringify(node.outlets),
    ],
  )

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: invalid ? INVALID_GHOST_COLOR : 0xff_ff_ff,
        emissive: invalid ? INVALID_GHOST_COLOR : 0xff_ff_ff,
        emissiveIntensity: 0.12,
        roughness: 0.7,
        metalness: 0.2,
        transparent: true,
        opacity: invalid ? 0.4 : 0.55,
        depthWrite: false,
        side: THREE.FrontSide,
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
    <>
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
    </>
  )
}

export default GutterPreview
