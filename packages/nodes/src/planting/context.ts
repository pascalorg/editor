import {
  type GeometryContext,
  type PlantingNode,
  resolvePlantingAccept,
  resolveSiteGround,
} from '@pascal-app/core'
import { siteContextNodes } from '../shared/site-context'

/** Both representations read the same Site snapshot and exclusion predicate as agent facts. */
export function plantingContext(node: PlantingNode, ctx?: Partial<GeometryContext>) {
  const nodes = siteContextNodes(node, ctx)
  const ground = resolveSiteGround(node.parentId, nodes)
  return { ground, accept: resolvePlantingAccept(node, nodes, ground) }
}
