'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildDownspoutGeometry } from './geometry'
import type { DownspoutRouting } from './routing'
import type { DownspoutNode } from './schema'

/**
 * Translucent ghost of a downspout — same geometry as the committed
 * pipe so the placement ghost matches what lands on click. No
 * internal transform wrapper; the placement tool nests this under
 * the gutter / outlet chain so the position math stays in one place.
 *
 * `routing` mirrors the renderer's — when the tool resolves the host
 * gutter it feeds the same wall-jog so the ghost already shows the
 * elbowed path, not a straight drop.
 */
const DownspoutPreview = ({
  node,
  routing,
  invalid,
}: {
  node: DownspoutNode
  routing?: DownspoutRouting | null
  invalid?: boolean
}) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildDownspoutGeometry(node, routing),
    [
      node.length,
      node.diameter,
      node.standoff,
      node.shape,
      node.strapStyle,
      node.strapSpacing,
      node.terminal,
      routing,
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
      <mesh geometry={geometry} material={material} raycast={() => {}} />
      <lineSegments geometry={edgesGeometry} renderOrder={1000}>
        <lineBasicMaterial color={0x6c_a3_ff} depthTest={false} opacity={0.9} transparent />
      </lineSegments>
    </>
  )
}

export default DownspoutPreview
