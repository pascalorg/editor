'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildDormerGeometry } from './geometry'
import type { DormerNode } from './schema'

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  emissive: 0xff_ff_ff,
  emissiveIntensity: 0.1,
  roughness: 0.5,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
})

const DormerPreview = ({ node }: { node: DormerNode }) => {
  const geo = useMemo(() => buildDormerGeometry(node), [
    node.width,
    node.depth,
    node.height,
    node.roofHeight,
    node.roofType,
  ])

  useEffect(
    () => () => {
      geo.body.dispose()
      geo.roof.dispose()
    },
    [geo],
  )

  return (
    <group>
      <mesh geometry={geo.body} material={ghostMaterial} raycast={() => {}} />
      <mesh geometry={geo.roof} material={ghostMaterial} raycast={() => {}} />
    </group>
  )
}

export default DormerPreview
