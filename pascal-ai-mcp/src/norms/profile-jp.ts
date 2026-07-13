// ---------------------------------------------------------------------------
// Japan profile (first target market) — confirmed values from
// NORMS_PROFILE_DESIGN.md §2 (2026-07-10). 1帖 = 1.62㎡ (§2.4 决定 1).
//
// Landed so far: partition parameters, default room areas, §2.3 area tiers
// (incl. the LDK ladder by bedroom count) and J7 帖 quantization. The
// UB-spec-by-areaBand refinement and the J6 bathroom split land with their
// batches (design doc §4) — until then `bathroom` bounds stay permissive
// because トイレ / 洗面脱衣 / 浴室 share the type (方案 B).
// ---------------------------------------------------------------------------

import type { RoomType } from '../layout-plan'
import type { NormProfile } from './profile'

const JO = 1.62 // ㎡ per 帖

// Defaults in 帖, then converted — keeps the table readable against §2.3.
const JP_ROOM_AREAS_JO: Record<RoomType, number> = {
  bedroom: 6, // 単身寝室舒适下段
  living: 12,
  living_kitchen: 16, // LDK 舒适区间 12–20帖 中段
  dining: 4.5,
  kitchen: 3, // 独立キッチン下限
  bathroom: 2.5, // 方案 B 合并房型（トイレ/洗面/浴室按 name 区分前的过渡值）
  study: 4.5,
  hallway: 3,
  entry: 1.5, // 玄関舒适区间 1.5–2帖
  storage: 1.5,
  balcony: 2,
  other: 4.5,
}

export const JP_NORM_PROFILE: NormProfile = {
  id: 'jp',
  partition: {
    // 尺モジュール半間（910mm）design width; effective width after wall
    // deduction stays above the 0.78m fatal floor (J4).
    corridorWidthM: 0.91,
    maxRoomAspect: 3.0,
    maxFootprintAspect: 2.2,
    // うなぎの寝床 tradition: jp narrow lots run deeper than the default cap.
    maxFootprintAspectNarrowLot: 4.5,
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
    deviationWeight: 3,
  },
  defaultRoomAreas: Object.fromEntries(
    Object.entries(JP_ROOM_AREAS_JO).map(([type, jo]) => [type, Math.round(jo * JO * 100) / 100]),
  ) as Record<RoomType, number>,
  // §2.3 tiers. fatalMin is the 下限 column; soft range is the 舒适区间.
  roomAreaBounds(context) {
    // LDK ladder（不動産表示規約の目安）: LDK ≥8帖 with ≤1 bedroom, ≥10帖
    // with 2+.
    const ldkFatalMinJo = context.bedroomCount >= 2 ? 10 : 8
    return {
      bedroom: { fatalMin: 4.5 * JO, softMin: 6 * JO, softMax: 8 * JO, fatalMax: 20 * JO },
      living: { fatalMin: ldkFatalMinJo * JO, softMin: 12 * JO, softMax: 20 * JO, fatalMax: 32 * JO },
      kitchen: { fatalMin: 3 * JO, softMin: 3 * JO, softMax: 4.5 * JO, fatalMax: 7.5 * JO },
      // 方案 B：トイレ（0.75帖起）/ 洗面脱衣（1帖）/ 浴室（UB 1216≈1.2帖）
      // 共用 bathroom 类型，取并集下限，J6 拆分后收紧。
      bathroom: { fatalMin: 0.7 * JO, softMin: 1 * JO, softMax: 3 * JO, fatalMax: 5 * JO },
    }
  },
  // J7: room target areas snap to 0.25帖.
  areaQuantization: { unitSqm: JO, stepUnits: 0.25 },
}
