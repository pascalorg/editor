import { type AnyNodeId, type SceneApi, TreeNode } from '@pascal-app/core'
import { addTree } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { isGridSnapActive, useEditor, visibleScene } from '@pascal-app/editor'

type Point = [number, number]

export function snapTreePlacementPoint(point: Point, force = false): Point {
  const step = !force && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  return step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
}

/** The SVG consumes its own input; a retained canvas tool never handles it as well. */
export function ownsTreePlacement(view: '2d' | '3d', target: EventTarget | null): boolean {
  if (view === '3d')
    return (
      visibleScene(useEditor.getState()) !== '2d' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      target instanceof HTMLCanvasElement
    )
  return typeof SVGElement !== 'undefined' && target instanceof SVGElement
}

/** One click is one tree in the shared operation, including its trunk-in-building refusal. */
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
      {
        activeLevelId: null,
      },
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
  if (!sceneApi.applyChanges) throw new Error('Tree placement requires atomic scene changes.')
  try {
    const { result, changes } = addTree(
      sceneApi.nodes(),
      { siteId, seed, trees: [{ at }] },
      { activeLevelId: null },
    )
    const id = Array.isArray(result.treeIds) ? result.treeIds[0] : undefined
    if (typeof id !== 'string') return null
    sceneApi.applyChanges({
      create: changes?.create?.map(({ node, parentId }) => ({
        node: TreeNode.parse(node),
        parentId: parentId as AnyNodeId | undefined,
      })),
    })
    select(id as AnyNodeId)
    return id as AnyNodeId
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    onRefusal?.(error.code)
    return null
  }
}
