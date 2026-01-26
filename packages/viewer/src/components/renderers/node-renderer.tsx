'use client'

import { type AnyNode, useScene } from '@pascal-app/core'
import { BuildingRenderer } from './building/building-renderer'
import { ItemRenderer } from './item/item-renderer'
import { LevelRenderer } from './level/level-renderer'
import { SlabRenderer } from './slab/slab-renderer'
import { WallRenderer } from './wall/wall-renderer'
import { ZoneRenderer } from './zone/zone-renderer'

export const NodeRenderer = ({ nodeId }: { nodeId: AnyNode['id'] }) => {
  const node = useScene((state) => state.nodes[nodeId])

  if (!node) return null

  return (
    <>
      {node.type === 'building' && <BuildingRenderer node={node} />}
      {node.type === 'level' && <LevelRenderer node={node} />}
      {node.type === 'item' && <ItemRenderer node={node} />}
      {node.type === 'slab' && <SlabRenderer node={node} />}
      {node.type === 'wall' && <WallRenderer node={node} />}
      {node.type === 'zone' && <ZoneRenderer node={node} />}
    </>
  )
}
