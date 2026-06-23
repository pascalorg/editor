/**
 * Snapping mode is a single global, user-cyclable control that maps onto the
 * two pre-existing snap knobs (`gridSnapStep` grid snap + `magneticSnap`).
 * The default `'grid'` resolves to the exact pair the editor shipped with
 * before this control existed (grid on, magnetic on), so the default path is
 * behaviourally unchanged — only when a user opts into `'lines'` or `'off'`
 * does any snap math get suppressed.
 */
export type SnappingMode = 'grid' | 'lines' | 'angles' | 'off'

export const SNAPPING_MODES: SnappingMode[] = ['grid', 'lines', 'angles', 'off']

export const DEFAULT_SNAPPING_MODE: SnappingMode = 'grid'

export type SnapFlags = {
  grid: boolean
  magnetic: boolean
  angles: boolean
}

/**
 * Pure mapping from the curated mode enum onto the individual snap knobs.
 *
 * - `grid`   → grid + magnetic + angles (today's default; full snapping).
 * - `lines`  → magnetic only (alignment / wall beacons, no grid lattice, no
 *   angle lock).
 * - `angles` → angle lock only (15° wall/line rays, no grid lattice, no
 *   magnetic beacons).
 * - `off`    → nothing snaps.
 */
export function resolveSnapFlags(mode: SnappingMode): SnapFlags {
  switch (mode) {
    case 'grid':
      return { grid: true, magnetic: true, angles: true }
    case 'lines':
      return { grid: false, magnetic: true, angles: false }
    case 'angles':
      return { grid: false, magnetic: false, angles: true }
    case 'off':
      return { grid: false, magnetic: false, angles: false }
  }
}

const SNAPPING_MODE_LABELS: Record<SnappingMode, string> = {
  grid: 'Grid',
  lines: 'Lines',
  angles: 'Angles',
  off: 'Off',
}

export function getSnappingModeLabel(mode: SnappingMode): string {
  return SNAPPING_MODE_LABELS[mode]
}

export function nextSnappingMode(mode: SnappingMode): SnappingMode {
  const index = SNAPPING_MODES.indexOf(mode)
  return SNAPPING_MODES[(index + 1) % SNAPPING_MODES.length] ?? DEFAULT_SNAPPING_MODE
}
