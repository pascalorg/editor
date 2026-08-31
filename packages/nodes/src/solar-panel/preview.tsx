'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildSolarPanelGeometry } from './geometry'
import type { SolarPanelNode } from './schema'

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  emissive: 0xff_ff_ff,
  emissiveIntensity: 0.1,
  roughness: 0.5,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
})

const invalidGhostMaterial = new THREE.MeshStandardMaterial({
  color: INVALID_GHOST_COLOR,
  emissive: INVALID_GHOST_COLOR,
  emissiveIntensity: 0.12,
  roughness: 0.5,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
})

const SolarPanelPreview = ({ node, invalid }: { node: SolarPanelNode; invalid?: boolean }) => {
  const material = invalid ? invalidGhostMaterial : ghostMaterial

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildSolarPanelGeometry(node),
    [
      node.rows,
      node.columns,
      node.panelWidth,
      node.panelHeight,
      node.gapX,
      node.gapY,
      node.frameThickness,
      node.frameDepth,
      node.standoffHeight,
    ],
  )

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null

  return (
    <mesh
      geometry={geometry}
      material={material}
      raycast={() => {
        /* preview should not intercept the cursor */
      }}
    />
  )
}

export default SolarPanelPreview
