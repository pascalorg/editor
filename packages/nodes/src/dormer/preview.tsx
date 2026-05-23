'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildDormerGhostGeometry } from './geometry'
import type { DormerNode } from './schema'

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0x88_88_88,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
})

const DormerPreview = ({ node }: { node: DormerNode }) => {
  const geo = useMemo(
    () => buildDormerGhostGeometry(node),
    [node.width, node.depth, node.height, node.roofHeight, node.roofType, node.wallSkirtHeight],
  )

  useEffect(() => () => geo.dispose(), [geo])

  return <mesh geometry={geo} material={ghostMaterial} raycast={() => {}} />
}

export default DormerPreview
