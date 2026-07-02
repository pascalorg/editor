'use client'

import { getFlowerVariant } from './flower-geometry'
import type { FlowerNode } from './flower-schema'
import { KindProxy } from './instanced'

const getVariant = (node: FlowerNode) => getFlowerVariant(node)
const colliderRadius = (node: FlowerNode) => Math.max(0.06, (node.height ?? 0.5) * 0.22)

/** Per-node selection proxy for the instanced flowers. */
export default function FlowerProxyRenderer({ node }: { node: FlowerNode }) {
  return <KindProxy colliderRadius={colliderRadius} getVariant={getVariant} node={node} />
}
