import type { GeometryContext } from '../registry/types'
import type { AnyNode, CeilingNode, SlabNode } from '../schema'
import { getEffectiveNode } from '../store/use-live-node-overrides'
import useLiveTransforms from '../store/use-live-transforms'
import { resolveCutterHost } from './cutter-host'

type Surface = CeilingNode | SlabNode

export function getEffectiveCutterNode(node: AnyNode): AnyNode {
  const effective = getEffectiveNode(node)
  const live = useLiveTransforms.getState().get(node.id)
  if (effective.type !== 'item' || !live) return effective
  // Ceiling drags publish building-local Y; the mounting depth stays host-relative.
  return {
    ...effective,
    position:
      effective.asset.attachTo === 'ceiling'
        ? [live.position[0], effective.position[1], live.position[2]]
        : live.position,
    rotation: [effective.rotation[0], live.rotation, effective.rotation[2]],
  }
}

/** Only the host's neighbourhood is needed; pure builders need no scene store. */
export function cutterContextNodes(
  surface: Surface,
  context: GeometryContext,
): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = { [surface.id]: surface }
  const parent = context.parent
  if (parent) nodes[parent.id] = parent
  for (const id of [
    ...(parent && 'children' in parent ? parent.children : []),
    ...('children' in surface ? surface.children : []),
  ]) {
    const node = context.resolve(id as AnyNode['id'])
    if (node) nodes[node.id] = getEffectiveCutterNode(node)
  }
  return nodes
}

/** Through-holes are derived, so moving/deleting/undoing the owner cannot leave stale openings. */
export function hostedCutterHoles(
  surface: Surface,
  nodes: Readonly<Record<string, AnyNode>>,
): [number, number][][] {
  const holes: [number, number][][] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'item' || !node.source?.manifest.cutters?.length) continue
    for (const cutter of node.source.manifest.cutters) {
      const name = cutter.host === 'mounted' ? 'cutout' : `cut:${cutter.host}`
      if (resolveCutterHost(node, name, nodes)?.id !== surface.id) continue
      // Item Y is relative to its support: floor elevation is added by the viewer,
      // while a ceiling child already lives in the ceiling's local frame.
      const minY =
        node.position[1] + Math.min(cutter.minY * node.scale[1], cutter.maxY * node.scale[1])
      const maxY =
        node.position[1] + Math.max(cutter.minY * node.scale[1], cutter.maxY * node.scale[1])
      const bottom = surface.type === 'slab' ? -surface.thickness : 0
      if (minY > 1e-5 || maxY < bottom - 1e-5) continue
      const cos = Math.cos(node.rotation[1]),
        sin = Math.sin(node.rotation[1])
      holes.push(
        cutter.polygon.map(([x, z]): [number, number] => [
          node.position[0] + x! * node.scale[0] * cos + z! * node.scale[2] * sin,
          node.position[2] - x! * node.scale[0] * sin + z! * node.scale[2] * cos,
        ]),
      )
    }
  }
  return holes
}

export function withHostedCutterHoles<T extends Surface>(
  surface: T,
  nodes: Readonly<Record<string, AnyNode>>,
): T {
  const holes = hostedCutterHoles(surface, nodes)
  return holes.length ? { ...surface, holes: [...surface.holes, ...holes] } : surface
}
