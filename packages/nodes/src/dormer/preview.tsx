'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildDormerGhostGeometry } from './geometry'
import type { DormerNode } from './schema'

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0x88_88_88,
  transparent: true,
  opacity: 0.45,
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

const DormerPreview = ({ node, invalid }: { node: DormerNode; invalid?: boolean }) => {
  const material = invalid ? invalidGhostMaterial : ghostMaterial

  const geo = useMemo(
    () => buildDormerGhostGeometry(node),
    [node.width, node.depth, node.height, node.roofHeight, node.roofType, node.wallSkirtHeight],
  )

  useEffect(() => () => geo.dispose(), [geo])

  return <mesh geometry={geo} material={material} raycast={() => {}} />
}

export default DormerPreview
