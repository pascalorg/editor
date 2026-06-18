'use client'

import { alignFloorplanDraftPoint, useAlignmentGuides } from '@pascal-app/editor'

type Vec3 = [number, number, number]

/**
 * Layer Figma-style alignment guides onto a draw-tool cursor point so HVAC /
 * DWV runs and equipment line up with each other (and every other node) while
 * being drawn — the same feedback walls get.
 *
 * Treats the point as a single corner anchor, gathers candidates from the live
 * scene (every kind contributes via `nodeAlignmentAnchors`), publishes the
 * guides to `useAlignmentGuides` (rendered in BOTH the 2D floor plan and the
 * 3D view), and returns the point with the snap applied. Y is preserved — only
 * XZ is aligned.
 *
 * - `applySnap: false` publishes the guide passively without pulling the point
 *   off a constrained ray (e.g. an angle-locked run continuation).
 * - `bypass: true` clears guides and returns the point untouched (Alt, or when
 *   a stronger port / run-body snap already won).
 */
export function alignDrawPoint(point: Vec3, opts: { applySnap: boolean; bypass?: boolean }): Vec3 {
  if (opts.bypass) {
    useAlignmentGuides.getState().clear()
    return point
  }
  const [x, z] = alignFloorplanDraftPoint([point[0], point[2]], { applySnap: opts.applySnap })
  return [x, point[1], z]
}

/** Drop any alignment guides this tool published (cancel / commit / unmount). */
export function clearDrawAlignment(): void {
  useAlignmentGuides.getState().clear()
}
