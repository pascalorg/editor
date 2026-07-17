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

import type { LayoutIntent, LayoutIntentRoom } from './layout-plan'
import { isDiningKitchenName } from './lang/room-vocab'
import {
  detectKitchenPreference,
  detectLShape,
  detectNarrowLot,
  detectSiteHint,
  isServiceRoomName,
  parseRoomProgram,
  roomProgramHub,
  type JapaneseRoomProgram,
} from './lang/strategy-vocab'
import type { NormProfile } from './norms/profile'
import { areaBoundFor } from './plan-validator'

export type AreaBand = 'tiny' | 'compact' | 'standard' | 'large'

export type BriefFacts = {
  kitchenPreference?: 'open' | 'closed'
  // S3: lot dimensions as written in the brief (orientation not normalized).
  siteHint?: { widthM: number; depthM: number }
  // Brief says "narrow lot" without giving dimensions.
  narrowLot?: boolean
  // S5: brief says the lot / home is L-shaped.
  lShape?: boolean
  // Japanese room-program shorthand (2DK/1LDK/1R/1K), parsed deterministically
  // from the brief. Carried through strategy → intent normalization →
  // template matcher instead of being re-derived from model room names.
  roomProgram?: JapaneseRoomProgram
  // S in the program token (2SLDK): number of demanded サービスルーム/納戸.
  // Rides beside the base program — see strategy-vocab parseRoomProgram.
  serviceRoomCount?: number
}

export type StrategyDecision = {
  // v1 enum only holds topologies the partitioner can execute (§3.2).
  typology: 'studio' | 'standard_band' | 'narrow_lot' | 'tanoji' | 'l_shape'
  areaBand: AreaBand
  kitchenMode: 'open' | 'closed'
  // User wording beats band defaults (§3.3); conflict handling needs to know
  // which one decided. 'program' = implied by a DK/LDK room program (the hub
  // is combined by definition) without explicit open-kitchen wording.
  kitchenModeSource: 'user' | 'band_default' | 'program'
  // §3.3 scope guard: the kitchen-mode prompt line tells the model HOW to
  // build a kitchen — injecting it when the brief never asked for one nudges
  // the model into adding rooms beyond scope (case-12 regression).
  kitchenInScope: boolean
  // J5 (jp profile): every home has a 玄関.
  entryRequired: boolean
  // S3: fixed lot footprint for the partitioner. Only set for narrow_lot —
  // that's its sole consumer today (§1 invariant 2).
  footprintHint?: { widthM: number; depthM: number }
  // Japanese room program from the brief; consumed by intent normalization
  // (applyStrategy) and the template matcher (findTemplateSeed).
  roomProgram?: JapaneseRoomProgram
  // SLDK 变体的服务间数量：prompt 要求納戸、模板种子对 >0 一律禁用。
  serviceRoomCount?: number
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
  const parsed = parseRoomProgram(briefText)
  if (parsed) {
    facts.roomProgram = parsed.program
    if (parsed.serviceRoomCount > 0) facts.serviceRoomCount = parsed.serviceRoomCount
  }
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

  // A DK/LDK program combines the kitchen into the hub BY DEFINITION, and a
  // 1K/1R program keeps a standalone kitchen zone BY DEFINITION (1R's
  // corridor kitchen is modeled as its own kitchen room — tpl-jp-1r-37) —
  // both override the band default (compact band defaults to open, which
  // would prompt a living_kitchen no 1K/1R template has), but never an
  // explicit user preference.
  const programHub = roomProgramHub(facts.roomProgram)
  const programSeparate = facts.roomProgram === '1k' || facts.roomProgram === '1r'
  let kitchenMode = facts.kitchenPreference
    ?? (areaBand === 'tiny' || areaBand === 'compact' ? 'open' : 'closed')
  let kitchenModeSource: StrategyDecision['kitchenModeSource'] =
    facts.kitchenPreference ? 'user' : 'band_default'
  if (facts.kitchenPreference === undefined) {
    if (programHub && kitchenMode !== 'open') {
      kitchenMode = 'open'
      kitchenModeSource = 'program'
    } else if (programSeparate && kitchenMode !== 'closed') {
      kitchenMode = 'closed'
      kitchenModeSource = 'program'
    }
  } else if (programSeparate && facts.kitchenPreference === 'open') {
    // Codex 复审 #2：1K/1R 的厨房与居室分离是房型编号的定义（模板也按独立
    // kitchen polygon 建模）——编号优先于开放式偏好，且冲突必须留痕（进
    // plan.notes 用户可见），不能把 open 记成已接受再被 prompt/归一化各行
    // 其是。想要开放式客餐厨的正确编号是 1LDK/Studio。
    kitchenMode = 'closed'
    kitchenModeSource = 'program'
    notes.push(
      `策略冲突：房型 ${facts.roomProgram!.toUpperCase()} 的厨房按定义与居室分离（廊下型/独立），`
      + '与「开放式厨房」偏好冲突，已按房型编号处理——如需开放式客餐厨请改用 1LDK 或单间 Studio',
    )
  }
  // In scope when the brief has no explicit room list (full-home assumption),
  // lists a kitchen, names a DK/LDK program, or the user voiced a kitchen
  // preference. A living-only list does NOT pull the kitchen into scope.
  const kitchenInScope =
    facts.kitchenPreference !== undefined
    || facts.roomProgram !== undefined
    || !targets.requiredRooms
    || targets.requiredRooms.some(room => room.type === 'kitchen' || room.type === 'living_kitchen')
  if (kitchenInScope) {
    notes.push(
      kitchenModeSource === 'user'
        ? `厨房模式：${kitchenMode === 'open' ? '开放式' : '独立式'}（用户明确要求）`
        : kitchenModeSource === 'program'
          ? (programHub
              ? `厨房模式：开放式（房型 ${facts.roomProgram!.toUpperCase()} 的${programHub === 'DK' ? '餐厨' : '客餐厨'}一体）`
              : `厨房模式：独立式（房型 ${facts.roomProgram!.toUpperCase()} 的厨房与居室分离）`)
          : `厨房模式：${kitchenMode === 'open' ? '开放式' : '独立式'}（${areaBand} 面积段默认）`,
    )
  } else {
    notes.push('需求范围不含厨房，厨房模式指令不注入 prompt')
  }

  const entryRequired = profile.id === 'jp'
  if (entryRequired) notes.push('日本档案：户型必须包含玄関（J5）')
  if (facts.roomProgram) notes.push(`日本房型编号：${facts.roomProgram.toUpperCase()}（从需求确定性解析）`)
  const serviceRoomCount = facts.serviceRoomCount ?? 0
  if (serviceRoomCount > 0) {
    notes.push(
      `房型编号含 S：需 ${serviceRoomCount} 间サービスルーム（納戸），模板种子仅允许明确含足量服务间的参照`,
    )
  }

  return {
    typology,
    areaBand,
    kitchenMode,
    kitchenModeSource,
    kitchenInScope,
    entryRequired,
    ...(footprintHint ? { footprintHint } : {}),
    ...(facts.roomProgram ? { roomProgram: facts.roomProgram } : {}),
    ...(serviceRoomCount > 0 ? { serviceRoomCount } : {}),
    notes,
  }
}

// Prompt lines injected into the Intent request (§4 tier 2). Chinese — the
// Intent system prompt is Chinese by design.
export function strategyPromptLines(decision: StrategyDecision): string {
  const lines = [`- 面积段：${decision.areaBand}`]
  const hub = roomProgramHub(decision.roomProgram)
  if (decision.kitchenInScope) {
    lines.push(
      decision.roomProgram === '1k' || decision.roomProgram === '1r'
        ? `- 房型 ${decision.roomProgram.toUpperCase()}：输出一间主要居室（type bedroom，兼起居）+ 一间独立厨房（type kitchen${decision.roomProgram === '1r' ? '，廊下型/居室一角的厨房区' : ''}），不要 living / dining / living_kitchen`
        : hub && decision.kitchenMode === 'open'
          ? `- 房型 ${decision.roomProgram!.toUpperCase()}：输出一间 type 为 living_kitchen、name 为「${hub}」的${hub === 'DK' ? '餐厨一体间（不含独立客厅）' : '客餐厨一体间'}，不要单独的 living / dining / kitchen`
          : decision.kitchenMode === 'open'
            ? '- 厨房模式：开放式 —— 输出一间 type 为 living_kitchen 的房间，不要单独的 living + kitchen'
            : '- 厨房模式：独立式 —— 保留独立的厨房房间，除非需求另有明确要求',
    )
  }
  if ((decision.serviceRoomCount ?? 0) > 0) {
    lines.push(
      `- 房型编号含 S：必须包含 ${decision.serviceRoomCount} 间服务间（type storage，name「納戸」，无采光要求）——`
      + '这是可住人/置物的房间，不是衣柜；不要用クローゼット/收纳替代，也不要省略',
    )
  }
  if (decision.entryRequired) lines.push('- 必须包含一间 type 为 entry 的玄关')
  return `户型策略（系统按需求判定，规划时必须遵守）：\n${lines.join('\n')}`
}

// Remap adjacency references of merged rooms onto the surviving room, then
// drop self-pairs and duplicates. Shared by every merge below.
function remapAdjacency(
  adjacency: Array<{ a: string; b: string }> | undefined,
  mergedIds: Set<string>,
  targetId: string,
): Array<{ a: string; b: string }> | undefined {
  if (!adjacency) return adjacency
  const remapped = adjacency
    .map(pair => ({
      a: mergedIds.has(pair.a) ? targetId : pair.a,
      b: mergedIds.has(pair.b) ? targetId : pair.b,
    }))
    .filter(pair => pair.a !== pair.b)
  const seen = new Set<string>()
  return remapped.filter(pair => {
    const key = pair.a < pair.b ? `${pair.a}|${pair.b}` : `${pair.b}|${pair.a}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Fold `members` (≥1 room) into the first one, which takes `patch`. Areas sum
// only when EVERY member declares one — a partial sum (or the primary's own
// fragment area) would understate the hub, so otherwise the merged room
// carries no target and the profile defaults decide. Window: any true wins.
function foldRooms(
  rooms: LayoutIntentRoom[],
  adjacency: Array<{ a: string; b: string }> | undefined,
  members: LayoutIntentRoom[],
  patch: Partial<Pick<LayoutIntentRoom, 'type' | 'name'>>,
): { rooms: LayoutIntentRoom[]; adjacency: Array<{ a: string; b: string }> | undefined } {
  const primary = members[0]!
  const mergedIds = new Set(members.slice(1).map(room => room.id))
  const area = members.every(room => room.targetAreaSqm !== undefined)
    ? members.reduce((sum, room) => sum + room.targetAreaSqm!, 0)
    : undefined
  const window = members.some(room => room.requiresExteriorWindow === true)
    ? true
    : primary.requiresExteriorWindow
  const nextRooms = rooms
    .filter(room => !mergedIds.has(room.id))
    .map(room => {
      if (room.id !== primary.id) return room
      const { targetAreaSqm: _dropped, ...rest } = room
      return {
        ...rest,
        ...patch,
        ...(area !== undefined ? { targetAreaSqm: area } : {}),
        ...(window !== undefined ? { requiresExteriorWindow: window } : {}),
      }
    })
  return { rooms: nextRooms, adjacency: remapAdjacency(adjacency, mergedIds, primary.id) }
}

// Tier-1 enforcement (§4): rule-executable constraints are corrected
// silently on the parsed intent instead of burning a model correction round.
// Every change is recorded in notes (surfaced on the plan).
export function applyStrategy(
  intent: LayoutIntent,
  decision: StrategyDecision,
  profile?: NormProfile,
): { intent: LayoutIntent; notes: string[] } {
  const notes: string[] = []
  let rooms = [...intent.rooms]
  let adjacency = intent.adjacency ? [...intent.adjacency] : undefined

  // Room-program normalization (deterministic, before any band-default
  // merging): the model splits DK/LDK into living/dining/kitchen at random —
  // the program from the brief, not the model's room split, decides the hub.
  // DK and LDK stay distinct hub forms (isDiningKitchenName drives both the
  // area bounds and the template matcher), so the merged room is renamed
  // whenever its name would classify as the wrong form.
  const programHub = roomProgramHub(decision.roomProgram)
  if (programHub && decision.kitchenMode === 'open') {
    const preference: Array<LayoutIntentRoom['type']> = ['living_kitchen', 'living', 'dining', 'kitchen']
    const members = preference
      .flatMap(type => rooms.filter(room => room.type === type))
    if (members.length > 0) {
      const primary = members[0]!
      const wantDk = programHub === 'DK'
      const name = isDiningKitchenName(primary.name) === wantDk ? primary.name : programHub
      if (members.length > 1 || name !== primary.name || primary.type !== 'living_kitchen') {
        const folded = foldRooms(rooms, adjacency, members, { type: 'living_kitchen', name })
        rooms = folded.rooms
        adjacency = folded.adjacency
        notes.push(
          members.length > 1
            ? `策略修正：房型 ${decision.roomProgram!.toUpperCase()}，${members.map(room => `「${room.name}」`).join('、')}归一为一间「${name}」（living_kitchen）`
            : `策略修正：房型 ${decision.roomProgram!.toUpperCase()}，「${primary.name}」规范为「${name}」（living_kitchen）`,
        )
      }
    }
  } else if (programHub === 'LDK' && decision.kitchenMode === 'closed') {
    // Separate-kitchen NLDK variant (explicit 独立厨房): LD is one room, the
    // kitchen stays standalone — fold living/dining (and, when a standalone
    // kitchen already exists, any stray living_kitchen too: the combined
    // room is then really the LD) into one living room, so the intent
    // matches how such references are modeled (e.g. tpl-jp-2ldk-58). A
    // living_kitchen WITHOUT a standalone kitchen stays untouched — splitting
    // one room into two would fabricate a kitchen the model never planned;
    // the conflict note below covers that case.
    const hasStandaloneKitchen = rooms.some(room => room.type === 'kitchen')
    const members = [
      ...rooms.filter(room => room.type === 'living'),
      ...(hasStandaloneKitchen ? rooms.filter(room => room.type === 'living_kitchen') : []),
      ...rooms.filter(room => room.type === 'dining'),
    ]
    if (members.length > 1 || (members.length === 1 && members[0]!.type === 'living_kitchen')) {
      const primary = members[0]!
      // A retyped living_kitchen keeps a hub-sounding name ("LDK") that the
      // vocab would misclassify — rename to the standard LD shorthand.
      const name = primary.type === 'living_kitchen' ? 'LD' : primary.name
      const folded = foldRooms(rooms, adjacency, members, { type: 'living', name })
      rooms = folded.rooms
      adjacency = folded.adjacency
      notes.push(
        `策略修正：房型 ${decision.roomProgram!.toUpperCase()}（独立厨房），${members.map(room => `「${room.name}」`).join('、')}归一为一间客餐厅（living），厨房保持独立`,
      )
    }
  } else if (
    (decision.roomProgram === '1k' || decision.roomProgram === '1r')
    && decision.kitchenMode === 'closed'
  ) {
    // 1K/1R canonical shape: one dwelling room (bedroom) + one standalone
    // kitchen zone (1R's corridor kitchen is modeled the same way —
    // tpl-jp-1r-37). Deterministic repairs for the model's usual deviations;
    // an intent without any bedroom is left to the partitioner fallback.
    const bedroom = rooms.find(room => room.type === 'bedroom')
    if (bedroom) {
      const combined = rooms.filter(room => room.type === 'living_kitchen')
      if (!rooms.some(room => room.type === 'kitchen') && combined.length > 0) {
        // The combined room is the only kitchen carrier — it becomes the
        // standalone kitchen (§4 clamps an oversized target down later).
        const target = combined[0]!
        rooms = rooms.map(room => room.id === target.id
          ? { ...room, type: 'kitchen' as const, name: 'キッチン' }
          : room)
        notes.push(`策略修正：房型 ${decision.roomProgram.toUpperCase()}，「${target.name}」规范为独立厨房`)
      }
      const extras = rooms.filter(room =>
        room.type === 'living' || room.type === 'dining' || room.type === 'living_kitchen')
      if (extras.length > 0) {
        const folded = foldRooms(rooms, adjacency, [bedroom, ...extras], {})
        rooms = folded.rooms
        adjacency = folded.adjacency
        notes.push(
          `策略修正：房型 ${decision.roomProgram.toUpperCase()}，${extras.map(room => `「${room.name}」`).join('、')}并入主居室「${bedroom.name}」`,
        )
      }
    }
  }

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
    adjacency = remapAdjacency(adjacency, strayIds, combined.id)
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
    adjacency = remapAdjacency(adjacency, new Set([kitchen.id]), living.id)
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

  // SLDK 服务间保障（Codex 复审 #1）：prompt 已要求納戸，模型仍遗漏时确定性
  // 补上。普通 storage（クローゼット/収納/衣帽间）不能抵扣 S；只有明确命名
  // 为服务间的 storage 才计数，否则 2SLDK 仍会静默退化成带衣柜的 2LDK。
  const demandedServiceRooms = decision.serviceRoomCount ?? 0
  const existingServiceRooms = rooms.filter(
    room => room.type === 'storage' && isServiceRoomName(room.name),
  ).length
  const missingServiceRooms = Math.max(0, demandedServiceRooms - existingServiceRooms)
  if (missingServiceRooms > 0) {
    const ids = new Set(rooms.map(room => room.id))
    for (let n = 1, added = 0; added < missingServiceRooms; n++) {
      const id = `service-${n}`
      if (ids.has(id)) continue
      const ordinal = existingServiceRooms + added + 1
      rooms = [...rooms, { id, name: ordinal === 1 ? '納戸' : `納戸${ordinal}`, type: 'storage' }]
      ids.add(id)
      added++
    }
    notes.push(`策略修正：房型编号含 S，补充 ${missingServiceRooms} 间納戸（服务间）`)
  }

  if (decision.entryRequired && !rooms.some(room => room.type === 'entry')) {
    let id = 'entry-1'
    let n = 1
    const ids = new Set(rooms.map(room => room.id))
    while (ids.has(id)) id = `entry-${++n}`
    rooms = [...rooms, { id, name: '玄関', type: 'entry' }]
    notes.push('策略修正：自动补充玄関（日本档案 J5）')
  }

  // §4 tier-1（case-04 欠账补齐）：模型给出的目标面积越过档位的 fatal 界时，
  // 静默夹到舒适界并记 note——确定性可修复的问题不烧模型修正轮（23㎡ 厨房
  // 曾把三轮全部耗在 plan_rejected 上）。soft 界外 fatal 界内的轻微越界保留
  // 原值，由 validator 记 warning。
  if (profile) {
    const bedroomCount = rooms.filter(room => room.type === 'bedroom').length
    const boundsContext = { totalAreaSqm: intent.targetTotalAreaSqm, bedroomCount }
    const hasStandaloneKitchen = rooms.some(room => room.type === 'kitchen')
    rooms = rooms.map(room => {
      if (room.targetAreaSqm === undefined) return room
      const bound = areaBoundFor(profile, boundsContext, room.type, room.name, hasStandaloneKitchen)
      if (!bound) return room
      if (room.targetAreaSqm > bound.fatalMax) {
        notes.push(`策略修正：「${room.name}」目标面积 ${room.targetAreaSqm}㎡ 超出该房型合理区间，调整为 ${bound.softMax}㎡`)
        return { ...room, targetAreaSqm: bound.softMax }
      }
      if (room.targetAreaSqm < bound.fatalMin) {
        notes.push(`策略修正：「${room.name}」目标面积 ${room.targetAreaSqm}㎡ 低于该房型合理区间，调整为 ${bound.softMin}㎡`)
        return { ...room, targetAreaSqm: bound.softMin }
      }
      return room
    })
  }

  if (notes.length === 0) return { intent, notes }
  const applied: LayoutIntent = { targetTotalAreaSqm: intent.targetTotalAreaSqm, rooms }
  if (adjacency !== undefined && adjacency.length > 0) applied.adjacency = adjacency
  return { intent: applied, notes }
}
