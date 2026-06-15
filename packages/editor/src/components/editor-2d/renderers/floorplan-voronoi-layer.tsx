'use client'

import { collectLevelWallSegments, useScene, WALL_SNAP_DISTANCE_M } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useMemo } from 'react'
import useEditor from '../../../store/use-editor'

/**
 * Dev-only 2D debug overlay for the opening (door / window) wall snap.
 *
 * The snap (`findClosestWallInPlan`) attaches to a wall when the cursor is
 * within `WALL_SNAP_DISTANCE_M` of the wall's centerline, picking the
 * nearest such wall. The set of points within that radius of a segment is a
 * **capsule** (stadium): a band of half-width = the snap radius along the
 * wall, with semicircular caps at each end. That capsule IS the wall's
 * (normally invisible) hit target — so this layer draws it directly, one
 * analytic `<path>` per wall, instead of sampling a grid (which produced the
 * stair-stepped boundary the previous version showed). No per-point
 * classification, so it's cheap regardless of plan size.
 *
 * Where two walls sit closer than 2× the radius their capsules overlap; the
 * snap resolves the overlap to the nearer wall (the translucent fills just
 * blend there — a darker patch reads as "either wall is in reach, nearest
 * wins"). Drawing the true bisector-clipped cells would need the expensive
 * per-point pass this rewrite removes, and the hit-area view is what the
 * user asked for.
 *
 * Gated on `useEditor.show2dVoronoi` (developer menu). Renders inside the
 * floor-plan scene `<g>`, so it shares the plan→SVG transform and the scene
 * rotation with every other floor-plan layer.
 */

/** Stable hue per wall id so a wall keeps its colour across re-renders. */
function wallHue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  // Spread hues around the wheel with an offset that avoids a muddy
  // red-orange clump for short, similar ids.
  return (hash * 47) % 360
}

export const FloorplanVoronoiLayer = memo(function FloorplanVoronoiLayer() {
  const show2dVoronoi = useEditor((s) => s.show2dVoronoi)
  const selectedLevelId = useViewer((s) => s.selection.levelId)
  // Recompute only when the wall geometry on this level changes — not on
  // every scene write. Dragging a door updates the door node every frame;
  // keying the build on this string means the capsule paths don't rebuild
  // for openings, only for wall edits.
  const nodes = useScene((s) => s.nodes)
  const wallsKey = useMemo(() => {
    if (!show2dVoronoi || !selectedLevelId) return ''
    const segments = collectLevelWallSegments(nodes, selectedLevelId)
    return segments
      .map((s) => `${s.wall.id}:${s.start[0]},${s.start[1]},${s.end[0]},${s.end[1]}`)
      .join('|')
  }, [show2dVoronoi, selectedLevelId, nodes])

  const walls = useMemo(() => {
    if (!show2dVoronoi || !selectedLevelId || !wallsKey) return null
    // Read nodes imperatively: `wallsKey` already encodes every wall change,
    // so this memo is keyed on it rather than on the per-frame `nodes` ref.
    const segments = collectLevelWallSegments(useScene.getState().nodes, selectedLevelId)
    if (segments.length === 0) return null

    const R = WALL_SNAP_DISTANCE_M
    const r = R.toFixed(3)
    return segments.map((s) => {
      // Capsule outline. Normal = dir rotated +90° = (-dirY, dirX). Offset the
      // segment endpoints ±R along the normal for the long sides, then a
      // semicircular cap (radius R, sweep-flag 0 bulges outward past each end)
      // joins them. Verified winding holds for every orientation because the
      // whole construction is a rigid transform of the axis-aligned case.
      const nx = -s.dirY
      const ny = s.dirX
      const ax = (s.start[0] + nx * R).toFixed(3)
      const ay = (s.start[1] + ny * R).toFixed(3)
      const bx = (s.end[0] + nx * R).toFixed(3)
      const by = (s.end[1] + ny * R).toFixed(3)
      const cx = (s.end[0] - nx * R).toFixed(3)
      const cy = (s.end[1] - ny * R).toFixed(3)
      const dx = (s.start[0] - nx * R).toFixed(3)
      const dy = (s.start[1] - ny * R).toFixed(3)
      const d = `M${ax} ${ay}L${bx} ${by}A${r} ${r} 0 0 0 ${cx} ${cy}L${dx} ${dy}A${r} ${r} 0 0 0 ${ax} ${ay}Z`
      return {
        wallId: s.wall.id,
        d,
        hue: wallHue(s.wall.id),
        x1: s.start[0],
        y1: s.start[1],
        x2: s.end[0],
        y2: s.end[1],
      }
    })
  }, [show2dVoronoi, selectedLevelId, wallsKey])

  if (!walls) return null

  return (
    <g className="floorplan-voronoi-debug" pointerEvents="none">
      {walls.map(({ wallId, d, hue }) => (
        <path
          d={d}
          fill={`hsla(${hue}, 80%, 55%, 0.22)`}
          key={`hit-${wallId}`}
          stroke={`hsl(${hue}, 85%, 50%)`}
          strokeOpacity={0.5}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {walls.map(({ wallId, hue, x1, y1, x2, y2 }) => (
        <line
          key={`line-${wallId}`}
          stroke={`hsl(${hue}, 85%, 42%)`}
          strokeLinecap="round"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          x1={x1}
          x2={x2}
          y1={y1}
          y2={y2}
        />
      ))}
    </g>
  )
})
