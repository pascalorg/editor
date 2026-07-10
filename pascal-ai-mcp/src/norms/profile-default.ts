// ---------------------------------------------------------------------------
// Default profile — the pre-profile hardcoded values gathered verbatim
// (NORMS_PROFILE_DESIGN.md §1). Regression baseline: selecting this profile
// must reproduce the exact behavior the partitioner/validator had before the
// S0/S2 batches. Do not "improve" numbers here; market tuning belongs in
// market profiles.
// ---------------------------------------------------------------------------

import {
  BAND_HARD_HIGH_FACTOR,
  BAND_HARD_LOW_FACTOR,
  bandTableForTotalArea,
  type RoomKind,
} from '../layout-metrics'
import { DEFAULT_ROOM_AREAS } from '../layout-plan'
import type { AreaBounds, NormProfile } from './profile'

export const DEFAULT_NORM_PROFILE: NormProfile = {
  id: 'default',
  partition: {
    corridorWidthM: 1.15,
    maxRoomAspect: 3.0,
    maxFootprintAspect: 2.2,
    maxFootprintAspectNarrowLot: 4.0,
    minDoorEdgeM: 0.9,
    minRoomWidthSmallM: 1.5,
    minRoomWidthDefaultM: 1.8,
    carveablePublicMaxSqm: 9,
  },
  scoring: {
    idealFootprintAspect: 1.35,
    footprintAspectWeight: 6,
    roomAspectSoft: 2.2,
    roomAspectExcessWeight: 8,
    corridorShareSoft: 0.15,
    corridorShareExcessWeight: 120,
  },
  defaultRoomAreas: DEFAULT_ROOM_AREAS,
  // Pre-profile behavior verbatim: the CN band tables with the validator's
  // hard factors baked into fatal bounds.
  roomAreaBounds(context) {
    const bands = bandTableForTotalArea(context.totalAreaSqm)
    const bounds: Partial<Record<RoomKind, AreaBounds>> = {}
    for (const [kind, band] of Object.entries(bands) as Array<[RoomKind, [number, number]]>) {
      bounds[kind] = {
        fatalMin: band[0] * BAND_HARD_LOW_FACTOR,
        softMin: band[0],
        softMax: band[1],
        fatalMax: band[1] * BAND_HARD_HIGH_FACTOR,
      }
    }
    return bounds
  },
  areaQuantization: null,
}
