'use client'

import { getGrassVariant, grassVariantKey } from './grass-geometry'
import type { GrassNode } from './grass-schema'
import { InstancedKindSystem } from './instanced'

const variantKeyOf = (node: GrassNode) => grassVariantKey(node.preset, node.seed, node.bladeColor)
const getVariant = (node: GrassNode) => getGrassVariant(node)

/** Collective instanced renderer for every placed grass tuft (`def.system`). */
export default function GrassSystem() {
  return (
    <InstancedKindSystem<GrassNode>
      getVariant={getVariant}
      kind="trees:grass"
      variantKeyOf={variantKeyOf}
    />
  )
}
