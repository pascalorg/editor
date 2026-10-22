'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildFrameGeometry } from './frame-csg'
import { HingedGlass, LanternGlass, SlidingGlass } from './renderer'
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
  const root = useRef<THREE.Group>(null)
  // Glass subcomponents are shared with the scene renderer, so tag their descendants here.
  useLayoutEffect(() => {
    root.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  })
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

  useEffect(() => () => frame?.dispose(), [frame])
  useEffect(() => () => glass.dispose(), [glass])

  if (!frame) return null

  return (
    <group ref={root} rotation-y={node.rotation}>
      <mesh layers={EDITOR_LAYER} geometry={frame} material={material} raycast={() => {}} />
      {node.skylightType === 'lantern' ? (
        <LanternGlass
          node={node}
          curbHeight={node.curb ? node.curbHeight : 0}
          frameMaterial={material}
          glassMaterial={material}
        />
      ) : node.skylightType === 'opening' ? (
        <HingedGlass
          node={node}
          curbHeight={node.curb ? node.curbHeight : 0}
          frameMaterial={material}
          glassMaterial={material}
          glassThickness={node.glassThickness}
          hasMotorHousing={node.motorHousing}
          openAmount={node.operationState}
        />
      ) : node.skylightType === 'sliding' ? (
        <SlidingGlass
          node={node}
          curbHeight={node.curb ? node.curbHeight : 0}
          frameMaterial={material}
          glassMaterial={material}
          glassThickness={node.glassThickness}
          openAmount={node.operationState}
        />
      ) : (
        <mesh layers={EDITOR_LAYER} geometry={glass} material={material} raycast={() => {}} />
      )}
    </group>
  )
}

export default SkylightPreview
