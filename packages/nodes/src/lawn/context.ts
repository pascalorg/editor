import type { AnyNode, AnyNodeId, GeometryContext, LawnNode } from '@pascal-app/core'
import { siteContextNodes } from '../shared/site-context'

export function lawnContextNodes(
  node: LawnNode,
  ctx?: Partial<GeometryContext>,
): Record<string, AnyNode> {
  const parent =
    ctx?.parent ??
    (node.parentId
      ? (ctx?.sceneNodes?.[node.parentId as AnyNodeId] ??
        ctx?.resolve?.(node.parentId as AnyNodeId))
      : undefined)
  return siteContextNodes(node, { ...ctx, parent })
}
