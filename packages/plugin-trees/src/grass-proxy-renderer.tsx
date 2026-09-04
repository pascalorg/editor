'use client'

import { getGrassVariant } from './grass-geometry'
import type { GrassNode } from './grass-schema'
import { KindProxy } from './instanced'

const getVariant = (node: GrassNode) => getGrassVariant(node)
const colliderRadius = (node: GrassNode) => Math.max(0.08, (node.height ?? 0.4) * 0.3)

/** Per-node selection proxy for the instanced grass tufts. */
export default function GrassProxyRenderer({ node }: { node: GrassNode }) {
  return <KindProxy colliderRadius={colliderRadius} getVariant={getVariant} node={node} />
}
