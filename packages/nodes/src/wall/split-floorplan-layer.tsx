'use client'
import {
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  clientToPlan,
  FloorplanDraftWallMeasurement,
  type FloorplanToolContext,
  formatLinearMeasurement,
  useFloorplanRender,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { bindWallSplitPointer } from './split-pointer'
import { wallSplitDistance, wallSplitMarkerColor, wallSplitSegmentLabels } from './split-preview'
import { useWallSplit } from './split-store'

/** The plan side of the wall's `split` reshape (`reshapeLayers.split`): the same draft as 3D. */
export default function WallSplitFloorplanLayer(_props: FloorplanToolContext) {
  const draft = useWallSplit((s) => s.draft)
  const wallId = draft?.wallId
  const wall = useScene((s) => (draft ? s.nodes[draft.wallId] : undefined))
  const levelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const isDark = useViewer((s) => getSceneTheme(s.sceneTheme).appearance === 'dark')
  const context = useFloorplanRender()
  const upp = context?.unitsPerPixel ?? 0.01
  useEffect(() => {
    if (!wallId || useScene.getState().nodes[wallId]?.parentId !== levelId) return
    const scene = document.querySelector<SVGGElement>('g[data-floorplan-scene]')
    const surface = scene?.ownerSVGElement
    if (!surface) return
    return bindWallSplitPointer(surface, (event) => {
      if (!(event.target instanceof Node) || !surface.contains(event.target)) return null
      const point = clientToPlan(event.clientX, event.clientY)
      const current = useScene.getState().nodes[wallId]
      if (!point || current?.type !== 'wall') return null
      const distance = wallSplitDistance(current, point)
      // Only the wall's own stroke is a target, including its endpoint exclusion zones.
      const frame = frameAt(current, distance)
      if (
        Math.hypot(frame.point.x - point[0], frame.point.y - point[1]) > hitHalfWidth(current, upp)
      )
        return null
      return distance
    })
  }, [wallId, levelId, upp])
  if (!draft || wall?.type !== 'wall' || wall.parentId !== levelId) return null
  const { preview, snap } = draft
  const half = hitHalfWidth(wall, upp)
  const color = wallSplitMarkerColor(preview.valid)
  const cut = preview.frames[0]?.point
  return (
    <g pointerEvents="none" data-testid="pascal-split-marker-2d">
      {snap?.kind === 'alignment' && cut && (
        <line
          stroke="#818cf8"
          strokeDasharray={`${4 * upp} ${3 * upp}`}
          strokeOpacity={0.8}
          strokeWidth={upp}
          x1={snap.anchor[0]}
          x2={cut.x}
          y1={snap.anchor[1]}
          y2={cut.y}
        />
      )}
      {preview.frames.map(({ point, normal }, index) => {
        const line = {
          x1: point.x - normal.x * half,
          y1: point.y - normal.y * half,
          x2: point.x + normal.x * half,
          y2: point.y + normal.y * half,
        }
        return (
          <g key={index}>
            <line {...line} stroke="#f7f3ed" strokeWidth={7 * upp} strokeLinecap="round" />
            <line {...line} stroke={color} strokeWidth={3 * upp} strokeLinecap="round" />
          </g>
        )
      })}
      {!preview.valid && cut ? (
        <text
          fill={color}
          fontSize={12 * upp}
          paintOrder="stroke"
          stroke={isDark ? '#0f172a' : '#ffffff'}
          strokeWidth={3 * upp}
          textAnchor="middle"
          x={cut.x}
          y={cut.y - half - 6 * upp}
        >
          {preview.message}
        </text>
      ) : (
        wallSplitSegmentLabels(wall, preview).map((segment, index) => (
          <FloorplanDraftWallMeasurement
            key={index}
            labelBackground={isDark ? '#0f172a' : '#ffffff'}
            labelText={isDark ? '#e2e8f0' : '#171717'}
            measurement={{
              lengthLabel: `${formatLinearMeasurement(segment.length, unit, metricNotation)}${segment.count > 1 ? ` × ${segment.count}` : ''}`,
              midpoint: segment.midpoint,
              direction: segment.direction,
              angleLabels: [],
            }}
            measurementStroke={context?.palette.measurementStroke ?? color}
            sceneRotationDeg={context?.sceneRotationDeg ?? 0}
            unitsPerPixel={upp}
          />
        ))
      )}
    </g>
  )
}

/** The wall's stroke plus a finger's width, so the cut can be grabbed at any zoom. */
function hitHalfWidth(wall: WallNode, upp: number) {
  return getWallThickness(wall) / 2 + 8 * upp
}

function frameAt(wall: WallNode, distance: number) {
  const length = getWallCurveLength(wall)
  return getWallCurveFrameAt(wall, length > 0 ? distance / length : 0)
}
