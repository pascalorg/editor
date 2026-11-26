import { type AnyNodeId, type SceneApi, TreeNode } from '@pascal-app/core'
import { addTree } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import {
  commitSiteOperationPlacement,
  ownsSitePlacement,
  snapSitePoint,
} from '../shared/site-placement'

type Point = [number, number]

export const snapTreePlacementPoint = snapSitePoint
export const ownsTreePlacement = ownsSitePlacement

/** A seed for the next hand-planted tree. */
export function drawTreeSeed(): number {
  return Math.floor(Math.random() * 2147483648)
}

/**
 * The tree a click would plant with this seed: what the tool shows as a ghost. Its shape does
 * not depend on where it stands, so it is asked of the operation on the bare Site: asked at a
 * point of the real scene, the operation refuses wherever a house stands (the Site's origin,
 * often), and there was no ghost at all. Null only without a Site.
 */
export function previewTree(
  nodes: ReturnType<SceneApi['nodes']>,
  siteId: string | undefined,
  seed: number,
): TreeNode | null {
  const sites = Object.values(nodes).filter((node) => node?.type === 'site')
  const site = siteId ? nodes[siteId as AnyNodeId] : sites.length === 1 ? sites[0] : undefined
  if (site?.type !== 'site') return null
  try {
    const bare = { [site.id]: { ...site, children: [] } } as unknown as typeof nodes
    const node = addTree(
      bare,
      { siteId: site.id, seed, trees: [{ at: [0, 0] }] },
      { activeLevelId: null },
    ).changes?.create?.[0]?.node
    return node ? TreeNode.parse(node) : null
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    return null
  }
}

/** Why a click at this point would plant nothing (the operation's refusal code), or null. */
export function treePlacementRefusal(
  nodes: ReturnType<SceneApi['nodes']>,
  siteId: string | undefined,
  at: Point,
): string | null {
  try {
    addTree(nodes, { siteId, seed: 0, trees: [{ at }] }, { activeLevelId: null })
    return null
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    return error.code
  }
}

export function placeTree(
  sceneApi: SceneApi,
  at: Point,
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (code: string) => void,
  /** The seed of the tree shown as a ghost, so the planted tree is that one. */
  seed: number = drawTreeSeed(),
): AnyNodeId | null {
  return commitSiteOperationPlacement({
    sceneApi,
    label: 'Tree placement',
    run: () =>
      addTree(sceneApi.nodes(), { siteId, seed, trees: [{ at }] }, { activeLevelId: null }),
    parseNode: (node) => TreeNode.parse(node),
    selectId: (result) => {
      const id = Array.isArray(result.treeIds) ? result.treeIds[0] : undefined
      return typeof id === 'string' ? (id as AnyNodeId) : null
    },
    select,
    onRefusal: (error) => onRefusal?.(error.code),
  })
}
