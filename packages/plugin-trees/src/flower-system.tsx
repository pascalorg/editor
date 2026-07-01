'use client'

import { flowerVariantKey, getFlowerVariant } from './flower-geometry'
import type { FlowerNode } from './flower-schema'
import { InstancedKindSystem } from './instanced'

const variantKeyOf = (node: FlowerNode) => flowerVariantKey(node.preset, node.seed, node.petalColor)
const getVariant = (node: FlowerNode) => getFlowerVariant(node)

/** Collective instanced renderer for every placed flower (`def.system`). */
export default function FlowersSystem() {
  return (
    <InstancedKindSystem<FlowerNode>
      getVariant={getVariant}
      kind="trees:flower"
      variantKeyOf={variantKeyOf}
    />
  )
}
