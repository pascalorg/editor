// ---------------------------------------------------------------------------
// LayoutStrategy — deterministic decision layer (LAYOUT_STRATEGY_DESIGN.md).
//
// Sits between the confirmed brief and Intent generation: rules decide the
// area band, typology and kitchen mode BEFORE the model runs, then
// `applyStrategy` silently enforces the rule-executable constraints on the
// parsed intent (design doc §4 tier 1 — no correction rounds spent). Zero
// model calls; every field has a live consumer (§1 invariant 2). Fields for
// future consumers (roomAreaTargets, partitionParams, scorerWeights,
// siteHint) land with their batches (§6), not here.
//
// Strategy decisions and notes stay Chinese — internal pipeline language;
// replies re-render at the boundary (src/lang/i18n.ts policy).
// ---------------------------------------------------------------------------

import type { LayoutIntent } from './layout-plan'
import { detectKitchenPreference, detectLShape, detectNarrowLot, detectSiteHint } from './lang/strategy-vocab'
import type { NormProfile } from './norms/profile'

export type AreaBand = 'tiny' | 'compact' | 'standard' | 'large'

export type BriefFacts = {
  kitchenPreference?: 'open' | 'closed'
  // S3: lot dimensions as written in the brief (orientation not normalized).
  siteHint?: { widthM: number; depthM: number }
  // Brief says "narrow lot" without giving dimensions.
  narrowLot?: boolean
  // S5: brief says the lot / home is L-shaped.
  lShape?: boolean
}

export type StrategyDecision = {
  // v1 enum only holds topologies the partitioner can execute (§3.2).
  typology: 'studio' | 'standard_band' | 'narrow_lot' | 'tanoji' | 'l_shape'
  areaBand: AreaBand
  kitchenMode: 'open' | 'closed'
  // User wording beats band defaults (§3.3); conflict handling needs to know
  // which one decided.
  kitchenModeSource: 'user' | 'band_default'
  // §3.3 scope guard: the kitchen-mode prompt line tells the model HOW to
  // build a kitchen — injecting it when the brief never asked for one nudges
  // the model into adding rooms beyond scope (case-12 regression).
  kitchenInScope: boolean
  // J5 (jp profile): every home has a 玄関.
  entryRequired: boolean
  // S3: fixed lot footprint for the partitioner. Only set for narrow_lot —
  // that's its sole consumer today (§1 invariant 2).
  footprintHint?: { widthM: number; depthM: number }
  notes: string[]
}

// areaBand cutoffs (design doc §3.1): <25 / 25–45 / 45–70 / ≥70 ㎡.
export function areaBandOf(totalAreaSqm: number | undefined): AreaBand {
  if (totalAreaSqm === undefined || !(totalAreaSqm > 0)) return 'standard'
  if (totalAreaSqm < 25) return 'tiny'
  if (totalAreaSqm < 45) return 'compact'
  if (totalAreaSqm < 70) return 'standard'
  return 'large'
}

// Deterministic keyword extraction from the confirmed brief summary. All
// fields optional — the strategy always has a band default to fall back on.
export function deriveBriefFacts(briefText: string): BriefFacts {
  const facts: BriefFacts = {}
  const kitchenPreference = detectKitchenPreference(briefText)
  if (kitchenPreference) facts.kitchenPreference = kitchenPreference
  const siteHint = detectSiteHint(briefText)
  if (siteHint) facts.siteHint = siteHint
  if (detectNarrowLot(briefText)) facts.narrowLot = true
  if (detectLShape(briefText)) facts.lShape = true
  return facts
}

export function deriveStrategy(
  facts: BriefFacts,
  targets: { totalAreaSqm?: number; requiredRooms?: Array<{ type: string; count: number }> },
  profile: NormProfile,
): StrategyDecision {
  const notes: string[] = []
  const areaBand = areaBandOf(targets.totalAreaSqm)
  if (targets.totalAreaSqm === undefined) {
    notes.push('需求未给出总面积，面积段按 standard 处理')
  }

  const roomCount = targets.requiredRooms?.reduce((sum, room) => sum + room.count, 0)
  // §3.2: siteHint aspect > 2.2 or explicit narrow-lot wording → narrow_lot.
  // A single-room brief stays studio regardless (singleRoomPlan handles it).
  const siteAspect = facts.siteHint
    ? Math.max(facts.siteHint.widthM, facts.siteHint.depthM)
      / Math.min(facts.siteHint.widthM, facts.siteHint.depthM)
    : undefined
  let typology: StrategyDecision['typology'] = roomCount === 1 ? 'studio' : 'standard_band'
  let footprintHint: StrategyDecision['footprintHint']
  if (typology !== 'studio' && facts.lShape) {
    // §3.2: explicit L-shaped lot is a site constraint, like narrow_lot.
    // A single dimension pair can't describe an L — wing proportions are
    // searched by the partitioner, so no footprintHint here.
    typology = 'l_shape'
    notes.push('需求明示 L 形地块，采用 L 形拓扑')
  } else if (typology !== 'studio' && ((siteAspect !== undefined && siteAspect > 2.2) || facts.narrowLot)) {
    typology = 'narrow_lot'
    if (facts.siteHint) {
      footprintHint = facts.siteHint
      notes.push(
        `狭长地块（${facts.siteHint.widthM}×${facts.siteHint.depthM}m，长宽比 ${siteAspect!.toFixed(1)}），采用线性拓扑`,
      )
    } else {
      notes.push('需求明示长条地块（未给尺寸），采用线性拓扑')
    }
  } else if (typology === 'standard_band') {
    // §3.2: 田の字 for standard/large 2–3 bedroom homes — a PREFERENCE, not a
    // constraint: the partitioner runs 田の字 candidates alongside the band
    // ones and the scorer picks, so an infeasible 田の字 degrades gracefully.
    const bedroomCount = targets.requiredRooms?.find(room => room.type === 'bedroom')?.count
    if (
      bedroomCount !== undefined && bedroomCount >= 2 && bedroomCount <= 3
      && (areaBand === 'standard' || areaBand === 'large')
    ) {
      typology = 'tanoji'
      notes.push(`${bedroomCount} 卧 ${areaBand} 面积段，田の字拓扑参与比选`)
    }
  }

  const kitchenMode = facts.kitchenPreference
    ?? (areaBand === 'tiny' || areaBand === 'compact' ? 'open' : 'closed')
  const kitchenModeSource: StrategyDecision['kitchenModeSource'] =
    facts.kitchenPreference ? 'user' : 'band_default'
  // In scope when the brief has no explicit room list (full-home assumption),
  // lists a kitchen, or the user voiced a kitchen preference. A living-only
  // list does NOT pull the kitchen into scope.
  const kitchenInScope =
    facts.kitchenPreference !== undefined
    || !targets.requiredRooms
    || targets.requiredRooms.some(room => room.type === 'kitchen' || room.type === 'living_kitchen')
  if (kitchenInScope) {
    notes.push(
      kitchenModeSource === 'user'
        ? `厨房模式：${kitchenMode === 'open' ? '开放式' : '独立式'}（用户明确要求）`
        : `厨房模式：${kitchenMode === 'open' ? '开放式' : '独立式'}（${areaBand} 面积段默认）`,
    )
  } else {
    notes.push('需求范围不含厨房，厨房模式指令不注入 prompt')
  }

  const entryRequired = profile.id === 'jp'
  if (entryRequired) notes.push('日本档案：户型必须包含玄関（J5）')

  return {
    typology,
    areaBand,
    kitchenMode,
    kitchenModeSource,
    kitchenInScope,
    entryRequired,
    ...(footprintHint ? { footprintHint } : {}),
    notes,
  }
}

// Prompt lines injected into the Intent request (§4 tier 2). Chinese — the
// Intent system prompt is Chinese by design.
export function strategyPromptLines(decision: StrategyDecision): string {
  const lines = [`- 面积段：${decision.areaBand}`]
  if (decision.kitchenInScope) {
    lines.push(
      decision.kitchenMode === 'open'
        ? '- 厨房模式：开放式 —— 输出一间 type 为 living_kitchen 的房间，不要单独的 living + kitchen'
        : '- 厨房模式：独立式 —— 保留独立的厨房房间，除非需求另有明确要求',
    )
  }
  if (decision.entryRequired) lines.push('- 必须包含一间 type 为 entry 的玄关')
  return `户型策略（系统按需求判定，规划时必须遵守）：\n${lines.join('\n')}`
}

// Tier-1 enforcement (§4): rule-executable constraints are corrected
// silently on the parsed intent instead of burning a model correction round.
// Every change is recorded in notes (surfaced on the plan).
export function applyStrategy(
  intent: LayoutIntent,
  decision: StrategyDecision,
): { intent: LayoutIntent; notes: string[] } {
  const notes: string[] = []
  let rooms = [...intent.rooms]
  let adjacency = intent.adjacency ? [...intent.adjacency] : undefined

  const living = rooms.find(room => room.type === 'living')
  const kitchen = rooms.find(room => room.type === 'kitchen')
  const hasCombined = rooms.some(room => room.type === 'living_kitchen')

  const combined = rooms.find(room => room.type === 'living_kitchen')
  if (decision.kitchenMode === 'open' && combined && (living || kitchen)) {
    // The model emitted a living_kitchen AND stray living/kitchen rooms —
    // fold the strays into the combined room (sum any explicit areas, remap
    // adjacency) instead of leaving a duplicate kitchen behind.
    const strays = [living, kitchen].filter((room): room is NonNullable<typeof room> => Boolean(room))
    const strayIds = new Set(strays.map(room => room.id))
    const extraArea = strays.reduce((sum, room) => sum + (room.targetAreaSqm ?? 0), 0)
    rooms = rooms
      .filter(room => !strayIds.has(room.id))
      // Only sum when the combined room has an explicit area of its own —
      // "stray areas alone" would UNDERSTATE the LDK (its default is larger).
      .map(room => room.id === combined.id && combined.targetAreaSqm !== undefined
        ? { ...room, targetAreaSqm: combined.targetAreaSqm + extraArea }
        : room)
    if (adjacency) {
      const remapped = adjacency
        .map(pair => ({
          a: strayIds.has(pair.a) ? combined.id : pair.a,
          b: strayIds.has(pair.b) ? combined.id : pair.b,
        }))
        .filter(pair => pair.a !== pair.b)
      const seen = new Set<string>()
      adjacency = remapped.filter(pair => {
        const key = pair.a < pair.b ? `${pair.a}|${pair.b}` : `${pair.b}|${pair.a}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    notes.push(
      `策略修正：开放式厨房，${strays.map(room => `「${room.name}」`).join('、')}并入「${combined.name}」`,
    )
  } else if (decision.kitchenMode === 'open' && living && kitchen && !hasCombined) {
    // Merge: the living room becomes the living_kitchen (keeps its id so
    // adjacency references stay mostly valid); kitchen references remap.
    const mergedArea = living.targetAreaSqm !== undefined && kitchen.targetAreaSqm !== undefined
      ? living.targetAreaSqm + kitchen.targetAreaSqm
      : undefined
    rooms = rooms
      .filter(room => room.id !== kitchen.id)
      .map(room => room.id === living.id
        ? {
            ...room,
            type: 'living_kitchen' as const,
            ...(mergedArea !== undefined ? { targetAreaSqm: mergedArea } : {}),
          }
        : room)
    if (adjacency) {
      const remapped = adjacency
        .map(pair => ({
          a: pair.a === kitchen.id ? living.id : pair.a,
          b: pair.b === kitchen.id ? living.id : pair.b,
        }))
        .filter(pair => pair.a !== pair.b)
      const seen = new Set<string>()
      adjacency = remapped.filter(pair => {
        const key = pair.a < pair.b ? `${pair.a}|${pair.b}` : `${pair.b}|${pair.a}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    notes.push(`策略修正：开放式厨房，「${living.name}」与「${kitchen.name}」合并为一体客餐厨`)
  } else if (
    decision.kitchenMode === 'closed'
    && decision.kitchenModeSource === 'user'
    && hasCombined
  ) {
    // Conflict rule (§3.3): user wanted a closed kitchen but the intent has a
    // combined LDK — don't hard-split, surface as a note.
    notes.push('策略提示：需求要求独立厨房，但规划输出了一体客餐厨，请确认是否符合预期')
  }

  if (decision.entryRequired && !rooms.some(room => room.type === 'entry')) {
    let id = 'entry-1'
    let n = 1
    const ids = new Set(rooms.map(room => room.id))
    while (ids.has(id)) id = `entry-${++n}`
    rooms = [...rooms, { id, name: '玄関', type: 'entry' }]
    notes.push('策略修正：自动补充玄関（日本档案 J5）')
  }

  if (notes.length === 0) return { intent, notes }
  const applied: LayoutIntent = { targetTotalAreaSqm: intent.targetTotalAreaSqm, rooms }
  if (adjacency !== undefined && adjacency.length > 0) applied.adjacency = adjacency
  return { intent: applied, notes }
}
