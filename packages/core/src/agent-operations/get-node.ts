import { refuse } from '../agent-tools/refusal'
import { floorFootprintName } from '../lib/floor-footprint-name'
import { isFloorAnchoredOpening } from '../lib/floor-opening-footprints'
import { getLevelDisplayName } from '../lib/level-name'
import { getOpeningFloorDatum } from '../lib/opening-floor-datum'
import type { AnyNode, AnyNodeId, WallNode } from '../schema'
import { nodeSchemaForKind } from '../schema/compiled-node-parsers'
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

/** What the scene decides for a node that the node does not store, from the node as parsed. */
function resolvedFields(nodes: SceneNodes, node: AnyNode): Record<string, unknown> {
  const host = node.parentId ? nodes[node.parentId] : undefined
  const wall = host?.type === 'wall' ? nodeSchemaForKind('wall')!.safeParse(host) : undefined
  if ((node.type === 'door' || node.type === 'window') && wall?.success)
    return {
      resolvedOpening: {
        floorDatum: getOpeningFloorDatum(wall.data as WallNode, node, nodes),
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
 * The resolved fields of a core node, read from it as its schema parses it (with the defaults a
 * stored node may omit). A read never fails on what is around the node: a node its schema rejects,
 * or one whose neighbours do not read, comes back as stored with `unresolved` saying why.
 */
function derivedFields(nodes: SceneNodes, node: AnyNode): Record<string, unknown> {
  const schema = nodeSchemaForKind(node.type)
  if (!schema) return {}
  const parsed = schema.safeParse(node)
  if (!parsed.success)
    return { unresolved: 'its schema rejects it: verify_scene lists what is wrong' }
  try {
    return resolvedFields(nodes, parsed.data as AnyNode)
  } catch (error) {
    return {
      unresolved: `the scene around it does not read (${error instanceof Error ? error.message : String(error)}): verify_scene lists what is wrong`,
    }
  }
}

/**
 * `get_node`: a node, whole, with what the scene decides for it (a wall's or a ceiling's height
 * when it has none of its own, a wall's thickness, a door's or window's floor and what it hangs
 * from, the name a level or a floor plate is shown by) and its ancestors; with the scene's
 * materials lent, the ones its finishes use. Its children are as stored; the ids among them that
 * name no node are listed again in `missingChildIds`.
 */
export const getNode: AgentOperation<{ id: string }> = (nodes, { id }, { materials }) => {
  const node = nodes[id]
  if (!node) refuse('node_not_found', `Node not found: ${id}.`, { id })
  const used = referencedSceneMaterialIds(node)
  const children = (node as { children?: unknown }).children
  const missingChildIds = Array.isArray(children)
    ? children.filter((child) => typeof child === 'string' && !nodes[child])
    : []
  return {
    result: {
      node: { ...node, ...derivedFields(nodes, node) },
      ancestorIds: ancestorIdsOf(nodes, id),
      ...(missingChildIds.length ? { missingChildIds } : {}),
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
