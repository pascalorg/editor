'use client'

import { memo } from 'react'
import { useWallMoveGhosts } from '../../store/use-wall-move-ghosts'

/**
 * Renders translucent dashed previews of bridge walls that the wall
 * junction planner will insert on commit. Mirrors the 3D
 * `GhostWallPreviewMesh` so 2D and 3D show the same intent mid-drag.
 *
 * Subscribes to `useWallMoveGhosts.bridges`; writes happen inside
 * `wallFloorplanMoveTarget.apply` (cleared on `commit` and by the move
 * overlay's unmount cleanup as a safety net).
 */
export const FloorplanWallMoveGhostLayer = memo(function FloorplanWallMoveGhostLayer() {
  const bridges = useWallMoveGhosts((s) => s.bridges)

  if (bridges.length === 0) return null

  return (
    <g pointerEvents="none">
      {bridges.map((bridge) => {
        // Draw the bridge as a thick stroke at the wall's plan-space
        // thickness — same convention as the actual wall renderer.
        // Dashes scale with thickness so they read consistently no
        // matter the wall size or viewport zoom (no `non-scaling-stroke`
        // here; we want the line to be N meters thick, not N pixels).
        const dash = bridge.thickness * 1.4
        const gap = bridge.thickness * 0.9
        return (
          <line
            key={bridge.id}
            opacity={0.45}
            stroke={bridge.color}
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="butt"
            strokeWidth={bridge.thickness}
            x1={bridge.start[0]}
            x2={bridge.end[0]}
            y1={bridge.start[1]}
            y2={bridge.end[1]}
          />
        )
      })}
    </g>
  )
})
