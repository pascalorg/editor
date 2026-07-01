'use client'

import { getFlowerVariant } from './flower-geometry'
import type { FlowerNode } from './flower-schema'
import { KindStatic } from './instanced'

const getVariant = (node: FlowerNode) => getFlowerVariant(node)

/** Live static flower for the baked `/viewer` (`def.bakeReplaceRenderer`). */
export default function FlowerStaticRenderer({ node }: { node: FlowerNode }) {
  return <KindStatic getVariant={getVariant} node={node} />
}
