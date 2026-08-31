'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildFrameGeometry } from './frame-csg'
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

const invalidGhostMaterial = new THREE.MeshStandardMaterial({
  color: INVALID_GHOST_COLOR,
  emissive: INVALID_GHOST_COLOR,
  emissiveIntensity: 0.12,
  roughness: 0.5,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
})

const SkylightPreview = ({ node, invalid }: { node: SkylightNode; invalid?: boolean }) => {
  const material = invalid ? invalidGhostMaterial : ghostMaterial

  const frame = useMemo(
    () =>
      buildFrameGeometry({
        curb: node.curb,
        curbHeight: node.curbHeight,
        frameDepth: node.frameDepth,
        frameThickness: node.frameThickness,
        height: node.height,
        width: node.width,
      }),
    [node.width, node.height, node.frameThickness, node.frameDepth, node.curb, node.curbHeight],
  )

  const glass = useMemo(() => {
    const g = new THREE.BoxGeometry(node.width, node.glassThickness, node.height)
    const curbH = node.curb ? Math.max(0, node.curbHeight ?? 0.1) : 0
    g.translate(0, curbH + node.glassThickness / 2, 0)
    return g
  }, [node.width, node.height, node.glassThickness, node.curb, node.curbHeight])

  useEffect(
    () => () => {
      frame?.dispose()
      glass.dispose()
    },
    [frame, glass],
  )

  if (!frame) return null

  return (
    <group>
      <mesh geometry={frame} material={material} raycast={() => {}} />
      <mesh geometry={glass} material={material} raycast={() => {}} />
    </group>
  )
}

export default SkylightPreview
