// ---------------------------------------------------------------------------
// NormProfile — market/regulation parameter profiles (NORMS_PROFILE_DESIGN.md).
//
// v1 (batch S0) carries exactly the fields the layout partitioner consumes
// today; validator/metrics/gates parameters land with their consumer batches
// (design doc §4) — no dormant fields. Rule semantics live in the design
// docs; once a value is here, THIS file is the source of truth for it.
// ---------------------------------------------------------------------------

import type { RoomKind } from '../layout-metrics'
import type { RoomType } from '../layout-plan'
import { DEFAULT_NORM_PROFILE } from './profile-default'
import { JP_NORM_PROFILE } from './profile-jp'

export type NormProfileId = 'default' | 'jp'

// Per-kind area bounds consumed by plan-validator check #7: outside
// [softMin, softMax] warns, outside [fatalMin, fatalMax] is fatal.
export type AreaBounds = {
  fatalMin: number
  softMin: number
  softMax: number
  fatalMax: number
}

export type AreaBoundsContext = {
  totalAreaSqm: number
  // JP LDK/DK minimums step up at 2+ bedrooms (NORMS_PROFILE_DESIGN.md §2.3).
  bedroomCount: number
}

export type PartitionParams = {
  // Design width of an auto-inserted corridor (plan coordinates, walls not
  // yet deducted).
  corridorWidthM: number
  maxRoomAspect: number
  maxFootprintAspect: number
  // Relaxed footprint cap for the narrow_lot topology (LAYOUT_STRATEGY_DESIGN.md
  // §3.2) — slender lots are the point there, the standard cap can't apply.
  maxFootprintAspectNarrowLot: number
  // Minimum straight wall run for a door or window.
  minDoorEdgeM: number
  // Column/carve minimum interior widths: small service rooms vs the rest.
  minRoomWidthSmallM: number
  minRoomWidthDefaultM: number
  // Public rooms up to this area may be carved into the hub when their
  // full-depth column would come out too narrow.
  carveablePublicMaxSqm: number
}

// Candidate-scoring parameters (LAYOUT_STRATEGY_DESIGN.md §3.6): soft
// targets and the penalty weight applied to the excess over each.
export type ScoringParams = {
  idealFootprintAspect: number
  footprintAspectWeight: number
  roomAspectSoft: number
  roomAspectExcessWeight: number
  corridorShareSoft: number
  corridorShareExcessWeight: number
}

export type NormProfile = {
  id: NormProfileId
  partition: PartitionParams
  scoring: ScoringParams
  // Per-type default target areas (sqm) when the intent omits targetAreaSqm.
  defaultRoomAreas: Record<RoomType, number>
  // Area tiers for plan-validator #7; default profile reproduces the
  // pre-profile band tables exactly.
  roomAreaBounds(context: AreaBoundsContext): Partial<Record<RoomKind, AreaBounds>>
  // J7 帖 grid: room target areas snap to stepUnits × unitSqm. null = off.
  areaQuantization: { unitSqm: number; stepUnits: number } | null
}

// Snaps an area onto the profile's quantization grid (min one step).
export function quantizeAreaSqm(
  area: number,
  quantization: NormProfile['areaQuantization'],
): number {
  if (!quantization) return area
  const step = quantization.unitSqm * quantization.stepUnits
  return Math.max(step, Math.round(area / step) * step)
}

const PROFILES: Record<NormProfileId, NormProfile> = {
  default: DEFAULT_NORM_PROFILE,
  jp: JP_NORM_PROFILE,
}

// Unknown/unset ids fall back to the default profile — selection must never
// fail generation.
export function resolveNormProfile(id: string | undefined): NormProfile {
  return (id && id in PROFILES) ? PROFILES[id as NormProfileId] : DEFAULT_NORM_PROFILE
}

export { DEFAULT_NORM_PROFILE, JP_NORM_PROFILE }
