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
export function placeTree(
  sceneApi: SceneApi,
  at: Point,
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (code: string) => void,
): AnyNodeId | null {
  if (!sceneApi.applyChanges) throw new Error('Tree placement requires atomic scene changes.')
  try {
    const { result, changes } = addTree(
      sceneApi.nodes(),
      { siteId, seed: Math.floor(Math.random() * 2147483648), trees: [{ at }] },
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
