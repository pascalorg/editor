'use client'

import { getGrassVariant, grassVariantKey } from './grass-geometry'
import type { GrassNode } from './grass-schema'
import { InstancedNodes } from './instanced'

const variantKeyOf = (node: GrassNode) => grassVariantKey(node.preset, node.seed, node.bladeColor)
const getVariant = (node: GrassNode) => getGrassVariant(node)

/** Collective baked-`/viewer` renderer for one level's grass (`bakeReplaceRenderer`). */
export default function GrassReplaceInstances({ nodes }: { nodes: GrassNode[] }) {
  return (
    <InstancedNodes getVariant={getVariant} localSpace nodes={nodes} variantKeyOf={variantKeyOf} />
  )
}
