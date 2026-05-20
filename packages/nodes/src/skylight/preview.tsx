'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildSkylightGeometry } from './geometry'
import type { SkylightNode } from './schema'

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  emissive: 0xff_ff_ff,
  emissiveIntensity: 0.12,
  roughness: 0.5,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
})

const SkylightPreview = ({ node }: { node: SkylightNode }) => {
  const geo = useMemo(() => buildSkylightGeometry(node), [
    node.width,
    node.height,
    node.frameThickness,
    node.frameDepth,
    node.glassThickness,
    node.curb,
    node.curbHeight,
  ])

  useEffect(
    () => () => {
      geo.frame.dispose()
      geo.glass.dispose()
    },
    [geo],
  )

  return (
    <group>
      <mesh geometry={geo.frame} material={ghostMaterial} raycast={() => {}} />
      <mesh geometry={geo.glass} material={ghostMaterial} raycast={() => {}} />
    </group>
  )
}

export default SkylightPreview
