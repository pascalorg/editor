'use client'

import {
  type ChimneyNode,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentSchema,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildChimneyGeometry } from './geometry'

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  emissive: 0xff_ff_ff,
  emissiveIntensity: 0.12,
  roughness: 0.85,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
})

const invalidGhostMaterial = new THREE.MeshStandardMaterial({
  color: INVALID_GHOST_COLOR,
  emissive: INVALID_GHOST_COLOR,
  emissiveIntensity: 0.12,
  roughness: 0.85,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
})

/**
 * The preview needs a segment fixture to build the body height. The
 * placement tool passes the segment under the cursor; when floating
 * (off-roof fallback), segment is absent — build against RoofSegmentNode
 * defaults so the ghost renders flat at the grid position with yaw 0.
 */
const ChimneyPreview = ({
  node,
  segment,
  invalid,
}: {
  node: ChimneyNode
  segment?: RoofSegmentNode
  invalid?: boolean
}) => {
  const material = invalid ? invalidGhostMaterial : ghostMaterial
  const effectiveSegment = segment ?? RoofSegmentSchema.parse({})

  const geo = useMemo(() => buildChimneyGeometry(node, effectiveSegment), [node, effectiveSegment])

  useEffect(
    () => () => {
      geo.body.dispose()
      geo.cap?.dispose()
      geo.flues?.dispose()
      geo.cricket?.dispose()
      geo.bands?.dispose()
    },
    [geo],
  )

  return (
    <group rotation-y={node.rotation}>
      <mesh geometry={geo.body} material={material} raycast={() => {}} />
      {geo.bands && <mesh geometry={geo.bands} material={material} raycast={() => {}} />}
      {geo.cap && <mesh geometry={geo.cap} material={material} raycast={() => {}} />}
      {geo.flues && <mesh geometry={geo.flues} material={material} raycast={() => {}} />}
      {geo.cricket && <mesh geometry={geo.cricket} material={material} raycast={() => {}} />}
    </group>
  )
}

export default ChimneyPreview
