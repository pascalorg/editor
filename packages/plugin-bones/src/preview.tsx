'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { LUMBER_COLOR, lumberBoxDims } from './lumber'
import type { LumberNode } from './schema'

/**
 * Translucent placement ghost — a single see-through member following the
 * cursor. Raycast is disabled via the empty handler so the ghost never
 * intercepts the cursor ray (which would freeze `grid:move`).
 */
export default function LumberPreview({ node }: { node: LumberNode }) {
  const dims = lumberBoxDims(node.size, node.length, node.orientation)
  return (
    <mesh layers={EDITOR_LAYER} position={[0, dims[1] / 2, 0]} raycast={() => null}>
      <boxGeometry args={dims} />
      <meshStandardMaterial
        color={LUMBER_COLOR}
        depthWrite={false}
        opacity={0.5}
        transparent
      />
    </mesh>
  )
}
