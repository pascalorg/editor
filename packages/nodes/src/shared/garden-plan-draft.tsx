'use client'

import {
  FloorplanDraftLayer,
  planDraftColors,
  TOOL_INVALID_COLOR,
  useFloorplanDraftPreview,
  useFloorplanRender,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'

type Point = [number, number]

const svgPoints = (points: Point[]) => points.map((point) => point.join(',')).join(' ')

/**
 * Tell the plan where the pointer is over it (the SVG's own pixels), so its badge with the
 * tool's icon follows. A garden plan tool takes the pointer moves before the panel sees them,
 * so it must say this itself.
 */
export function publishGardenPlanPointer(
  svg: SVGSVGElement,
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
) {
  const rect = svg.getBoundingClientRect()
  useFloorplanDraftPreview
    .getState()
    .setCursorPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top })
}

/**
 * The target under the pointer on the plan: the plan's own (the one the wall and slab tools
 * show), at the point a click would use, in plan metres. Cleared when the tool leaves.
 */
export function useGardenPlanTarget(point: Point | null) {
  const x = point?.[0]
  const y = point?.[1]
  useEffect(() => {
    useFloorplanDraftPreview
      .getState()
      .setCursorPoint(x === undefined || y === undefined ? null : [x, y])
  }, [x, y])
  useEffect(
    () => () => {
      const preview = useFloorplanDraftPreview.getState()
      preview.setCursorPoint(null)
      preview.setCursorPosition(null)
    },
    [],
  )
}

/**
 * A garden outline while it is drawn on the plan, through the plan's own draft drawing (the one
 * the slab and zone drafts use): the area's fill, the outline through the placed points to the
 * pointer, the dashed closing side and a marker on every placed point. Red while refused. Plan
 * metres; the target under the pointer is the plan's (`publishGardenPlanCursor`).
 */
export function GardenPlanDraft({
  points,
  hover,
  closed,
  message,
}: {
  points: Point[]
  hover: Point | null
  /** An area (planting bed, lawn) closes back on its first point; a line (hedge) does not. */
  closed: boolean
  /** Why the draft is refused; shown beside its first point. */
  message: string | null
}) {
  const render = useFloorplanRender()
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const colors = planDraftColors(isDark)
  const stroke = message ? TOOL_INVALID_COLOR : colors.stroke
  const fill = message ? TOOL_INVALID_COLOR : colors.fill
  const line = hover && points.length ? [...points, hover] : points
  const first = points[0]
  useGardenPlanTarget(hover)
  return (
    <g pointerEvents="none">
      <FloorplanDraftLayer
        anchorFill={stroke}
        draftAnchorPoints={points.map(([x, y], index) => ({ x, y, isPrimary: index === 0 }))}
        draftFill={fill}
        draftPolygonPoints={null}
        draftStroke={stroke}
        linearDraftSegment={null}
        polygonDraftClosingSegment={
          closed && hover && first && points.length >= 2
            ? { x1: hover[0], y1: hover[1], x2: first[0], y2: first[1] }
            : null
        }
        polygonDraftPolygonPoints={closed && line.length >= 3 ? svgPoints(line) : null}
        polygonDraftPolylinePoints={line.length >= 2 ? svgPoints(line) : null}
        unitsPerPixel={render?.unitsPerPixel ?? 0.01}
      />
      {message && first && (
        <text fill={TOOL_INVALID_COLOR} fontSize={0.18} x={first[0]} y={first[1] - 0.25}>
          {message}
        </text>
      )}
    </g>
  )
}
