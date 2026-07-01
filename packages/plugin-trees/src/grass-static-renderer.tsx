'use client'

import { getGrassVariant } from './grass-geometry'
import type { GrassNode } from './grass-schema'
import { KindStatic } from './instanced'

const getVariant = (node: GrassNode) => getGrassVariant(node)

/** Live static grass tuft for the baked `/viewer` (`def.bakeReplaceRenderer`). */
export default function GrassStaticRenderer({ node }: { node: GrassNode }) {
  return <KindStatic getVariant={getVariant} node={node} />
}
