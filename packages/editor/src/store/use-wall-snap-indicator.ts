// Ephemeral store for the "magnetic" wall-snap beacon shown during wall
// drafting. The wall tool writes the active snap point on pointermove when
// the draft endpoint locks onto existing wall geometry (a corner or a point
// along a wall); the 3D beacon layer subscribes and draws a vertical marker
// there. Cleared on commit, cancel, and unmount — same lifecycle as
// `use-alignment-guides`.

import { create } from 'zustand'

/** Which kind of wall geometry the draft point snapped to. */
export type WallSnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'wall'

/**
 * Names for the readout. The 3D beacon already encodes the kind as a glyph
 * shape, but a shape only tells an experienced user what was caught — the name
 * is what makes the snap legible the first time, and what lets someone say "it
 * grabbed the midpoint" instead of "it jumped".
 */
const WALL_SNAP_LABELS: Record<WallSnapKind, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  intersection: 'Intersection',
  wall: 'On wall',
}

export function wallSnapLabel(point: Pick<WallSnapPoint, 'kind' | 'source'>): string {
  // An imported drawing is never silently conflated with built geometry.
  if (point.source === 'cad') {
    return point.kind === 'wall'
      ? 'On drawing'
      : `Drawing ${WALL_SNAP_LABELS[point.kind].toLowerCase()}`
  }
  return WALL_SNAP_LABELS[point.kind]
}

export type WallSnapPoint = {
  /** Building-local plan coordinates (XZ meters). */
  x: number
  z: number
  kind: WallSnapKind
  /** Optional wall ids whose geometry produced this snap. */
  wallIds?: string[]
  /**
   * Where the geometry came from. `'cad'` is an imported reference drawing,
   * which the beacon tints differently so it is never ambiguous whether the
   * cursor caught the model or the drawing under it.
   */
  source?: 'wall' | 'cad'
}

type WallSnapIndicatorState = {
  point: WallSnapPoint | null
  set(point: WallSnapPoint | null): void
  clear(): void
}

const useWallSnapIndicator = create<WallSnapIndicatorState>((set) => ({
  point: null,
  set: (point) => set({ point }),
  clear: () => set({ point: null }),
}))

export default useWallSnapIndicator
