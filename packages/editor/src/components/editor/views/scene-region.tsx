'use client'

import type { ReactNode } from 'react'
import { isSceneView } from '../../../lib/editor-views'
import type { ViewLayout } from '../../../store/view-layout'
import { useActiveViewLayout } from './use-editor-views'

/** Horizontal span of a pane, as fractions of the stage width. */
export type StageSpan = { left: number; right: number }

export function paneSpan(layout: ViewLayout, pane: 0 | 1): StageSpan {
  if (!layout.split) return { left: 0, right: 1 }
  return pane === 0 ? { left: 0, right: layout.ratio } : { left: layout.ratio, right: 1 }
}

/**
 * The span of the panes showing the scene. 3D and 2D side by side share one
 * level selector and one tool dock across both, as the split always has; a
 * scene view next to another view keeps them over its own pane. `null` when no
 * scene view is on screen.
 */
export function sceneSpan(layout: ViewLayout): StageSpan | null {
  const spans = ([0, 1] as const)
    .filter((pane) => (pane === 0 || layout.split) && isSceneView(layout.panes[pane]))
    .map((pane) => paneSpan(layout, pane))
  if (spans.length === 0) return null
  return {
    left: Math.min(...spans.map((span) => span.left)),
    right: Math.max(...spans.map((span) => span.right)),
  }
}

export function useSceneSpan(): StageSpan | null {
  const layout = useActiveViewLayout()
  return sceneSpan(layout)
}

/**
 * Positions scene chrome (level selector, tool dock, host scene overlays) over
 * the scene panes. `translateZ(0)` makes it the containing block of the dock's
 * `position: fixed`, so the dock centres on the scene rather than the stage.
 */
export function SceneRegion({ children }: { children: ReactNode }) {
  const span = useSceneSpan()
  if (!span) return null
  return (
    <div
      className="pointer-events-none absolute inset-y-0"
      data-scene-region
      style={{
        left: `${span.left * 100}%`,
        width: `${(span.right - span.left) * 100}%`,
        transform: 'translateZ(0)',
      }}
    >
      {children}
    </div>
  )
}
