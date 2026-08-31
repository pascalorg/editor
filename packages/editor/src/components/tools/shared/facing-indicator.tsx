import { useEffect, useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'

// A flat forward-pointing triangle drawn on the floor just in front of a
// placement ghost, so the direction the node will face is obvious. Tip at local
// +Z (every kind's forward face); render it inside the ghost's rotated group so
// it inherits the node's yaw. Matches the item coordinator / drag-bounding-box
// indicators (same size, colour, double-sided so it shows from above).
const FACING_INDICATOR_WIDTH = 0.4
const FACING_INDICATOR_LENGTH = 0.46
const FACING_INDICATOR_GAP = 0.45

/**
 * @param depth    bbox depth (along local Z) of the ghost — positions the
 *                 triangle just past the front edge.
 * @param center   optional [x, z] of the bbox centre in the ghost's local frame.
 * @param reversed point along local -Z (the front is the -Z side, e.g. a stair
 *                 entry) instead of +Z.
 * @param y        small lift off the floor to avoid z-fighting.
 */
export function FacingIndicator({
  depth,
  center = [0, 0],
  reversed = false,
  y = 0.02,
}: {
  depth: number
  center?: [number, number]
  reversed?: boolean
  y?: number
}) {
  const dir = reversed ? -1 : 1
  // Per-instance geometry/material (not module singletons) so this works no
  // matter which package mounts it (the tools live in `nodes`, imported via
  // `@pascal-app/editor`). Disposed on unmount.
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute(
      'position',
      new Float32BufferAttribute(
        [
          0,
          0,
          dir * FACING_INDICATOR_LENGTH,
          FACING_INDICATOR_WIDTH / 2,
          0,
          0,
          -FACING_INDICATOR_WIDTH / 2,
          0,
          0,
        ],
        3,
      ),
    )
    return g
  }, [dir])
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: 0x22_c5_5e, // green-500 (forward)
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={EDITOR_LAYER}
      material={material}
      position={[center[0], y, center[1] + dir * (depth / 2 + FACING_INDICATOR_GAP)]}
      renderOrder={1001}
    />
  )
}
