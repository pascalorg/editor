import type { AnyNodeId, SceneApi } from '@pascal-app/core'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { isGridSnapActive, useEditor, visibleScene } from '@pascal-app/editor'

type Point = [number, number]

/** Snap a 2D Site coordinate to the active editor grid unless `force` disables snapping. */
export function snapSitePoint(point: Point, force = false): Point {
  const step = !force && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  return step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
}

/** Ensure 2D SVG clicks and 3D canvas clicks never handle the same pointer interaction twice. */
export function ownsSitePlacement(view: '2d' | '3d', target: EventTarget | null): boolean {
  if (view === '3d')
    return (
      visibleScene(useEditor.getState()) !== '2d' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      target instanceof HTMLCanvasElement
    )
  return typeof SVGElement !== 'undefined' && target instanceof SVGElement
}

/**
 * Execute an agent placement operation atomically through `sceneApi.applyChanges`, select the
 * created node id, and forward structured agent refusals without throwing in pointer handlers.
 */
export function commitSiteOperationPlacement<R>({
  sceneApi,
  label,
  run,
  parseNode,
  selectId,
  select,
  onRefusal,
}: {
  sceneApi: SceneApi
  label: string
  run: () => {
    result: R
    changes?: { create?: { node: unknown; parentId?: string }[] }
  }
  parseNode: (
    raw: unknown,
  ) => Parameters<NonNullable<SceneApi['applyChanges']>>[0]['create'] extends
    | (infer T)[]
    | undefined
    ? T extends { node: infer N }
      ? N
      : never
    : never
  selectId: (result: R) => AnyNodeId | null
  select: (id: AnyNodeId) => void
  onRefusal?: (error: { code: string; message: string }) => void
}): AnyNodeId | null {
  if (!sceneApi.applyChanges) throw new Error(`${label} requires atomic scene changes.`)
  try {
    const { result, changes } = run()
    const id = selectId(result)
    if (!id) return null
    sceneApi.applyChanges({
      create: changes?.create?.map(({ node, parentId }) => ({
        node: parseNode(node),
        parentId: parentId as AnyNodeId | undefined,
      })),
    })
    select(id)
    return id
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    onRefusal?.(error)
    return null
  }
}
