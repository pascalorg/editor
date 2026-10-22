/** The colour picker's swatches, in hue order. */
export const ZONE_COLOR_PALETTE = [
  '#ef4444', // Red        0°
  '#f97316', // Orange    30°
  '#f59e0b', // Amber     45°
  '#84cc16', // Lime      85°
  '#22c55e', // Green    142°
  '#10b981', // Emerald  160°
  '#06b6d4', // Cyan     190°
  '#3b82f6', // Blue     217°
  '#6366f1', // Indigo   239°
  '#a855f7', // Violet   270°
  '#64748b', // Dark gray
  '#cccccc', // Light gray
] as const

// Greys read as "no colour", so new rooms get one of the hues.
const ROOM_HUES = ZONE_COLOR_PALETTE.slice(0, 10)

/**
 * The colour a new zone is created with: a palette hue picked from a seed —
 * the zone's id, or for an imported room a value of its source that survives
 * re-import (a capture's id). Seeded rather than random, so every creator of
 * the same room — the browser's reconciler, the hosted MCP bridge, a capture
 * re-run — writes the same colour.
 */
export function zoneColorForSeed(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ROOM_HUES[(h >>> 0) % ROOM_HUES.length]!
}
