import type { AnyNode, SlabNode } from '../schema'
import { getScaledDimensions } from '../schema/nodes/item'
import { liftedManualSlab } from './floor-construction-lift'
import { selectSlabSupportForItem } from './item-slab-support'
import { getRenderableSlabPolygon, slabPolygonContextForLevel } from './slab-polygon'

export function isCutterName(name: string): boolean {
  return name === 'cutout' || name === 'cut:wall' || name === 'cut:ceiling' || name === 'cut:slab'
}

/** A cutter can only remove its object's host, never an overlapping neighbour. */
export function resolveCutterHost(
  node: AnyNode,
  name: string,
  nodes: Readonly<Record<string, AnyNode>>,
): AnyNode | undefined {
  if (!isCutterName(name)) return
  const parentId = node.parentId ?? ('wallId' in node ? node.wallId : undefined)
  const parent = parentId ? nodes[parentId] : undefined
  let host: AnyNode | undefined
  if (parent?.type === 'wall' || parent?.type === 'ceiling' || parent?.type === 'slab') {
    host = parent
  } else if (node.type === 'item' && !node.asset.attachTo && parent?.type === 'level') {
    if (node.supportSlabId === 'ground') return
    const context = slabPolygonContextForLevel(parent, (id) => nodes[id])
    const slabs = Object.values(nodes)
      .filter(
        (candidate): candidate is SlabNode =>
          candidate.type === 'slab' && candidate.parentId === parent.id,
      )
      .map((slab) => liftedManualSlab(nodes, slab))
    host = selectSlabSupportForItem(
      slabs,
      { position: node.position, dimensions: getScaledDimensions(node), rotation: node.rotation },
      (slab) => getRenderableSlabPolygon(slab, context),
      { preferredSlabId: node.supportSlabId },
    )
  }
  if (name !== 'cutout' && host?.type !== name.slice(4)) return
  return host
}
