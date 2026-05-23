'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
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

const SolarPanelPreview = ({ node }: { node: SolarPanelNode }) => {
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
      material={ghostMaterial}
      raycast={() => {
        /* preview should not intercept the cursor */
      }}
    />
  )
}

export default SolarPanelPreview
