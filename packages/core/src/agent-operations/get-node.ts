import { refuse } from '../agent-tools/refusal'
import { floorFootprintName } from '../lib/floor-footprint-name'
import { isFloorAnchoredOpening } from '../lib/floor-opening-footprints'
import { getLevelDisplayName } from '../lib/level-name'
import { getOpeningFloorDatum } from '../lib/opening-floor-datum'
import type { AnyNode, AnyNodeId } from '../schema'
import { resolveCeilingHeight } from '../services/level-height'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { wallResolvedHeight } from './level-reads'
import { referencedSceneMaterialIds } from './scene-materials'
import type { AgentOperation, SceneNodes } from './types'

const lists = (parent: AnyNode, id: string) =>
  'children' in parent &&
  Array.isArray(parent.children) &&
  (parent.children as unknown[]).some(
    (child) => child === id || (child as { id?: unknown } | null)?.id === id,
  )

/**
 * A node's ancestors, its parent first, up to the root. A node stored without a `parentId` (the
 * site, building and level of a scene assembled whole) is found in its parent's `children`.
 */
function ancestorIdsOf(nodes: SceneNodes, id: string): string[] {
  const out: string[] = []
  const seen = new Set([id])
  let current = nodes[id]
  while (current) {
    const childId = current.id
    const parentId =
      current.parentId && nodes[current.parentId]
        ? current.parentId
        : Object.values(nodes).find((node) => lists(node, childId))?.id
    if (!parentId || seen.has(parentId)) break
    seen.add(parentId)
    out.push(parentId)
    current = nodes[parentId]
  }
  return out
}

/** What the scene decides for a node that the node does not store, read beside its own fields. */
function derivedFields(nodes: SceneNodes, node: AnyNode): Record<string, unknown> {
  const host = node.parentId ? nodes[node.parentId] : undefined
  if ((node.type === 'door' || node.type === 'window') && host?.type === 'wall')
    return {
      resolvedOpening: {
        floorDatum: getOpeningFloorDatum(host, node, nodes),
        anchor: isFloorAnchoredOpening(node) ? 'floor' : 'wall',
      },
    }
  if (node.type === 'wall')
    return {
      resolvedHeight: wallResolvedHeight(nodes, node),
      heightIsExplicit: node.height !== undefined,
      resolvedThickness: getWallThickness(node),
    }
  if (node.type === 'ceiling')
    return {
      resolvedHeight: resolveCeilingHeight(node, nodes as Record<AnyNodeId, AnyNode>),
      heightIsExplicit: node.height != null,
    }
  if (node.type === 'level') return { displayName: getLevelDisplayName(node) }
  if (node.type === 'slab' && node.plateRole === 'base')
    return { displayName: floorFootprintName(nodes, node) }
  return {}
}

/**
 * `get_node`: a node, whole, with what the scene decides for it (a wall's or a ceiling's height
 * when it has none of its own, a wall's thickness, a door's or window's floor and what it hangs
 * from, the name a level or a floor plate is shown by) and its ancestors; with the scene's
 * materials lent, the ones its finishes use.
 */
export const getNode: AgentOperation<{ id: string }> = (nodes, { id }, { materials }) => {
  const node = nodes[id]
  if (!node) refuse('node_not_found', `Node not found: ${id}.`, { id })
  const used = referencedSceneMaterialIds(node)
  return {
    result: {
      node: { ...node, ...derivedFields(nodes, node) },
      ancestorIds: ancestorIdsOf(nodes, id),
      ...(materials
        ? {
            materials: Object.fromEntries(
              Object.values(materials)
                .filter((material) => used.has(material.id))
                .map((material) => [material.id, material]),
            ),
          }
        : {}),
    },
  }
}
