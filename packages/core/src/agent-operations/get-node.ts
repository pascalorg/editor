import { refuse } from '../agent-tools/refusal'
import { floorFootprintName } from '../lib/floor-footprint-name'
import { isFloorAnchoredOpening } from '../lib/floor-opening-footprints'
import { getLevelDisplayName } from '../lib/level-name'
import { getOpeningFloorDatum } from '../lib/opening-floor-datum'
import type { AnyNode, AnyNodeId } from '../schema'
import { parseNode } from '../schema/compiled-node-parsers'
import { resolveCeilingHeight } from '../services/level-height'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { wallResolvedHeight } from './level-reads'
import { referencedSceneMaterialIds } from './scene-materials'
import type { AgentOperation, SceneNodes } from './types'

/**
 * A node's ancestors, its parent first, up to the root. Both stores link every node's `parentId`
 * from its parent's `children` when they load a scene, so the operation reads `parentId`.
 */
function ancestorIdsOf(nodes: SceneNodes, id: string): string[] {
  const out: string[] = []
  const seen = new Set([id])
  let parentId = nodes[id]?.parentId
  while (parentId && nodes[parentId] && !seen.has(parentId)) {
    seen.add(parentId)
    out.push(parentId)
    parentId = nodes[parentId]!.parentId
  }
  return out
}

/**
 * What the scene decides for a node that the node does not store, read beside its own fields. A
 * node its schema rejects gets none: it is read as stored, and verify_scene says what is wrong.
 */
function derivedFields(nodes: SceneNodes, node: AnyNode): Record<string, unknown> {
  if (!parseNode(node).success) return {}
  const host = node.parentId ? nodes[node.parentId] : undefined
  if (
    (node.type === 'door' || node.type === 'window') &&
    host?.type === 'wall' &&
    parseNode(host).success
  )
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
