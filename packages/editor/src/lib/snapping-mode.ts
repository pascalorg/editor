import type { SnapProfile } from '@pascal-app/core'

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
 * Pure mapping from the mode enum onto the individual snap knobs. Modes are
 * EXCLUSIVE — each does exactly what its chip label says, one guide at a time,
 * so the HUD is honest:
 *
 * - `grid`   → grid lattice only.
 * - `lines`  → magnetic only: alignment axes + wall corner-join (connectivity
 *   is part of the "lines" magnetic snap, not a separate always-on behaviour).
 * - `angles` → angle lock only (15°/45° rays).
 * - `off`    → nothing snaps (raw cursor).
 */
export function resolveSnapFlags(mode: SnappingMode): SnapFlags {
  switch (mode) {
    case 'grid':
      return { grid: true, magnetic: false, angles: false }
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

// ── Per-context snapping ──────────────────────────────────────────────────────
//
// Snapping is no longer one global value: each *activity* has its own mode set
// and default, because they want different behaviour (drawing a wall wants a
// grid + angle lock; nudging an item wants free movement that only catches on
// alignment lines). The mode is remembered per context and shown live, so it's
// never a silent surprise — it just matches what you're doing.

export type SnapContext = 'wall' | 'item' | 'polygon'

// The cyclable mode-set for a context (distinct from the node's `SnapProfile`).
type SnapModeSet = { modes: SnappingMode[]; default: SnappingMode }

// `modes[0]` is the cycle's first entry; `default` is what a context starts at.
// The 'wall' set is the ONLY one with an angle lock — it applies solely when
// you're setting a segment's DIRECTION (wall/fence drafting + endpoint drag).
// Translating a whole wall, curving it, or drawing/moving a slab can't change an
// angle, so those use the no-angle 'polygon' set.
const SNAP_PROFILES: Record<SnapContext, SnapModeSet> = {
  // Wall / fence drafting + endpoint reshape: direction matters → angle lock.
  wall: { modes: ['grid', 'lines', 'angles', 'off'], default: 'grid' },
  // Item placement / move: free by default (lines = magnetic alignment only, no
  // grid lattice), grid opt-in, no angle lock (meaningless for a footprint).
  item: { modes: ['lines', 'grid', 'off'], default: 'lines' },
  // Structural / surface, no direction to set: slab / ceiling / roof draft+move,
  // whole wall/fence translate, curve reshape, polygon boundary edit. Grid by
  // default, NO angle lock.
  polygon: { modes: ['grid', 'lines', 'off'], default: 'grid' },
}

export const SNAP_CONTEXTS: SnapContext[] = ['wall', 'item', 'polygon']

export function snappingModesFor(context: SnapContext): SnappingMode[] {
  return SNAP_PROFILES[context].modes
}

export function defaultSnappingModeFor(context: SnapContext): SnappingMode {
  return SNAP_PROFILES[context].default
}

// Cycle within the context's own set (clamps a foreign value to the first entry).
export function cycleSnappingModeIn(context: SnapContext, mode: SnappingMode): SnappingMode {
  const modes = SNAP_PROFILES[context].modes
  const index = modes.indexOf(mode)
  return modes[(index + 1) % modes.length] ?? modes[0] ?? DEFAULT_SNAPPING_MODE
}

// The kind's declared `snapProfile` (from the registry) → the active mode-set
// context. The only behaviour difference is the angle lock, which a `structural`
// kind gets while SETTING DIRECTION (drafting a run/polygon, dragging an endpoint
// or a polygon vertex) — never while translating or curving. A node with no
// declared profile has no snapping UI (chip) yet — returns null.
function contextForProfile(
  profile: SnapProfile | undefined,
  directionSetting: boolean,
): SnapContext | null {
  if (profile === 'item') return 'item'
  if (profile === 'structural') return directionSetting ? 'wall' : 'polygon'
  return null
}

/**
 * The active snapping context, derived from what the user is doing — fully
 * node-declared: the kind's `snapProfile` (looked up via the injected
 * `profileOf`) supplies the data, and this maps (profile × action) to the
 * mode-set. No per-kind switch lives here. `profileOf` is injected so this stays
 * pure + testable and `snapping-mode` need not import the registry.
 *
 * Prefers the authoritative interaction scope; falls back to the build tool
 * because the `drafting` scope isn't wired yet (wall/slab draw runs idle).
 * Returns null when nothing snappable is active → no chip, safe-default snap.
 */
export function snapContextOf(args: {
  scope: { kind: string; nodeType?: string; reshape?: string; nodeId?: string; tool?: string }
  mode: string
  tool: string | null
  profileOf: (typeOrTool: string) => SnapProfile | undefined
  // Whether drafting a kind sets a direction (angle-lock meaningful). Injected
  // like `profileOf` so `snapping-mode` need not import the registry; defaults
  // to `true` (the structural draw default) when not supplied.
  draftDirectionalOf?: (typeOrTool: string) => boolean
}): SnapContext | null {
  const { scope, mode, tool, profileOf, draftDirectionalOf } = args
  switch (scope.kind) {
    case 'placing':
    case 'moving':
      // A whole-node translate never sets direction → no angle.
      return scope.nodeType ? contextForProfile(profileOf(scope.nodeType), false) : null
    case 'reshaping':
      // Dragging a wall ENDPOINT sets the segment's direction → angle-bearing
      // 'wall'. Curving, and polygon vertex/edge edits (boundary / hole), don't
      // — they use the no-angle 'polygon' set (grid / lines / off).
      return scope.reshape === 'endpoint' ? 'wall' : 'polygon'
    case 'drafting':
      return scope.tool
        ? contextForProfile(profileOf(scope.tool), draftDirectionalOf?.(scope.tool) ?? true)
        : null
    default:
      return mode === 'build' && tool
        ? contextForProfile(profileOf(tool), draftDirectionalOf?.(tool) ?? true)
        : null
  }
}
