'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { ArticraftVisual } from './renderer'
import type { ArticraftAssetNode } from './schema'
import type { Vec3 } from './types'

export default function ArticraftPreview({
  node,
  dimensions,
}: {
  node?: ArticraftAssetNode
  dimensions?: Vec3
}) {
  if (node) return <ArticraftVisual ghost node={node} />

  const bounds = dimensions ?? [1, 1, 1]
  const size: Vec3 = [
    Math.max(0.1, bounds[0]),
    Math.max(0.1, bounds[1]),
    Math.max(0.1, bounds[2]),
  ]
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[0, size[1] / 2, 0]}
      raycast={() => undefined}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color="#8b5cf6"
        depthWrite={false}
        opacity={0.28}
        transparent
      />
    </mesh>
  )
}
