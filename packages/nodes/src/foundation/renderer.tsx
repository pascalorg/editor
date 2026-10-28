'use client'

import { type FoundationNode, useLiveNodeOverrides, useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, type Group, Shape, ShapeGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'

/** Over the level plane, about where the slab's top stands: what a click on the foundation meets. */
const PICK_HEIGHT = 0.1

// Writes nothing (no colour, no depth, so no ink outline either): it is only there to be hit.
const pickMaterial = new MeshBasicNodeMaterial({
  colorWrite: false,
  depthWrite: false,
  side: DoubleSide,
  transparent: true,
  opacity: 0,
})

/**
 * A foundation outline in 3D draws no concrete of its own: the site's foundation draws it from the
 * outline (`genericFoundation`). In the foundation view it lays an unseen sheet over its outline,
 * so a click on the foundation picks it and its corners and sides can be dragged.
 */
export default function FoundationRenderer({ node: stored }: { node: FoundationNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(stored.id, 'foundation', ref)
  const live = useLiveNodeOverrides((state) => state.overrides.get(stored.id))
  const node = useMemo(
    () => (live ? ({ ...stored, ...live } as FoundationNode) : stored),
    [stored, live],
  )
  const handlers = useNodeEvents(node, 'foundation')
  const pickable = useViewer((state) => state.foundationView && !state.walkthroughMode)
  const geometry = useMemo(() => {
    if (!pickable || node.polygon.length < 3) return null
    const shape = new Shape()
    node.polygon.forEach(([x, z], index) => {
      if (index === 0) shape.moveTo(x, -z)
      else shape.lineTo(x, -z)
    })
    shape.closePath()
    return new ShapeGeometry(shape)
  }, [pickable, node.polygon])
  useEffect(() => () => geometry?.dispose(), [geometry])

  return (
    <group ref={ref}>
      {geometry && (
        <mesh
          geometry={geometry}
          material={pickMaterial}
          position={[0, PICK_HEIGHT, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          {...handlers}
        />
      )}
    </group>
  )
}
