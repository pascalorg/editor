import type { AnyNode, AnyNodeId, FloorplanMoveTarget } from '@pascal-app/core'
import { isGridSnapActive, useDrawingView, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { planToSite } from './site-frame'

type Point = [number, number]

/** Compute the mean vertex coordinate for a 2D plan polygon or polyline. */
export function sitePointsCenter(points: readonly Point[]): Point {
  return [
    points.reduce((sum, [x]) => sum + x, 0) / points.length,
    points.reduce((sum, [, z]) => sum + z, 0) / points.length,
  ]
}

/** Convert active floor-plan or site-plan coordinates into Site XZ metres for a Site child node. */
export function sitePlanToSite(
  node: Pick<AnyNode, 'parentId'>,
  nodes: Readonly<Record<string, AnyNode>>,
): (point: Point) => Point {
  const levelId = useViewer.getState().selection.levelId
  const level = levelId ? nodes[levelId] : undefined
  const parent = level?.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  const building = parent?.type === 'building' && parent.parentId === node.parentId ? parent : null
  const frame = useDrawingView.getState().drawingType === 'site-plan' ? null : building
  return (point) => planToSite(frame, point)
}

/** Wrap a Site-space move session so 2D floor-plan cursors transform into Site metres. */
export function wrapSiteFloorplanMoveTarget<N extends Pick<AnyNode, 'parentId'>>(
  createSession: FloorplanMoveTarget<N>,
): FloorplanMoveTarget<N> {
  return (args) => {
    const session = createSession(args)
    const toSite = sitePlanToSite(args.node, args.nodes)
    return {
      ...session,
      apply({ planPoint, modifiers }) {
        session.apply({ planPoint: toSite([planPoint[0], planPoint[1]]), modifiers })
      },
    }
  }
}

/** Shared grid-snap scalar helper for move sessions (`altKey` bypasses snapping). */
export function snapSiteCursorValue(modifiers: { altKey?: boolean }): (value: number) => number {
  const step = !modifiers.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  return (value: number) => (step > 0 ? Math.round(value / step) * step : value)
}
