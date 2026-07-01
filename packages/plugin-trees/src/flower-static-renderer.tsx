'use client'

import { flowerPetalColor, flowerVariantKey, getFlowerVariant } from './flower-geometry'
import type { FlowerNode } from './flower-schema'
import { InstancedNodes } from './instanced'

const variantKeyOf = (node: FlowerNode) =>
  flowerVariantKey(node.preset, node.seed, flowerPetalColor(node))
const getVariant = (node: FlowerNode) => getFlowerVariant(node)

/** Collective baked-`/viewer` renderer for one level's flowers (`bakeReplaceRenderer`). */
export default function FlowerReplaceInstances({ nodes }: { nodes: FlowerNode[] }) {
  return (
    <InstancedNodes getVariant={getVariant} localSpace nodes={nodes} variantKeyOf={variantKeyOf} />
  )
}
