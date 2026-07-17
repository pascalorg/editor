// ---------------------------------------------------------------------------
// Template seeding: bias generation toward the reference library.
//
// Before the partitioner runs, the intent is matched against templates/
// (docs/TEMPLATES.md). A "good" reference with the same core program —
// bedroom count, hub form (LDK vs DK vs separate living), standalone-kitchen
// presence — and a lot area within scaling range is adapted by uniform
// scaling and used AS the plan. Real listed floor plans carry the 水回りコア
// / 中央動線 idioms the partitioner hasn't learned yet, so a hit skips the
// solver entirely; any mismatch or post-scale validation fatal falls back to
// partitionLayout. Deterministic, zero model calls.
//
// Deliberate v1 limits:
// - per-room targetAreaSqm in the intent is ignored on a hit (template
//   proportions win; a note says so);
// - strategies with a footprintHint (explicit lot dims) never seed — uniform
//   scaling cannot honor exact lot dimensions;
// - site-constrained typologies (narrow_lot / l_shape) only seed from
//   templates of the same typology, and such templates never seed
//   unconstrained requests.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDiningKitchenName } from './lang/room-vocab'
import { isServiceRoomName } from './lang/strategy-vocab'
import {
  footprintArea,
  polygonArea,
  roundCm,
  type LayoutIntent,
  type LayoutPlan,
  type LayoutPlanRoom,
  type RoomType,
} from './layout-plan'
import type { NormProfile } from './norms/profile'
import type { PartitionStrategyHint } from './layout-partitioner'
import { validateLayoutPlan, type PlanTargets } from './plan-validator'

export type TemplateRecord = {
  id: string
  meta: {
    market: string
    label: string
    quality: 'good' | 'bad'
    typology?: string
    // Japanese room-program shorthand ('2dk', '1ldk', '1r', …) of the SOURCE
    // listing. When both the request and the template declare one, they must
    // match exactly — structure alone cannot tell 1R from 1K, or 1DK from a
    // 1LDK whose hub the source drawing labels "DK".
    roomProgram?: string
  }
  plan: LayoutPlan
}

export type TemplateSeedResult = {
  plan: LayoutPlan
  templateId: string
  notes: string[]
  validation: ReturnType<typeof validateLayoutPlan>
}

const DEFAULT_TEMPLATES_DIR = join(import.meta.dir, '..', 'templates')

// Area ratio the uniform scaling may bridge (linear scale ≈ ±10%).
const MIN_AREA_RATIO = 0.8
const MAX_AREA_RATIO = 1.25

// Room types the template is allowed to be RICHER in than the intent: real
// references carry 卫浴分离 / 収納 / 玄関 / 廊下 the intent never spells out.
const SERVICE_TYPES: ReadonlySet<RoomType> = new Set([
  'bathroom', 'storage', 'entry', 'hallway', 'balcony',
])
const SITE_CONSTRAINED_TYPOLOGIES = new Set(['narrow_lot', 'l_shape'])

type TemplateLibrary = { records: TemplateRecord[]; failures: string[] }

const templateCache = new Map<string, TemplateLibrary>()

// Dev/tests: drop the cached library so edited/added template files are
// re-read without a process restart.
export function invalidateTemplateCache(dir?: string): void {
  if (dir) templateCache.delete(dir)
  else templateCache.clear()
}

// Templates live in quality subfolders (templates/good/, templates/bad/) so
// the library reads at a glance; loose .json at the root keeps working.
export function templateFilePaths(dir: string): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) paths.push(join(dir, entry.name))
    else if (entry.isDirectory()) {
      for (const file of readdirSync(join(dir, entry.name))) {
        if (file.endsWith('.json')) paths.push(join(dir, entry.name, file))
      }
    }
  }
  return paths.sort()
}

// Per-file fault isolation: one broken JSON must not empty the whole library
// (and get the empty result cached until restart) — the bad file is skipped
// and recorded, everything else keeps working. Failures surface in the seed
// trace via findTemplateSeed.
function loadTemplateLibrary(dir: string = DEFAULT_TEMPLATES_DIR): TemplateLibrary {
  const cached = templateCache.get(dir)
  if (cached) return cached
  const records: TemplateRecord[] = []
  const failures: string[] = []
  let paths: string[] = []
  try {
    paths = templateFilePaths(dir)
  } catch (error) {
    failures.push(`templates dir unreadable: ${dir} (${error instanceof Error ? error.message : String(error)})`)
  }
  for (const path of paths) {
    try {
      const record = JSON.parse(readFileSync(path, 'utf8')) as TemplateRecord
      if (record?.plan?.rooms && record?.meta) records.push(record)
      else failures.push(`${path}: missing meta/plan — not a template`)
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const library = { records, failures }
  templateCache.set(dir, library)
  return library
}

export function loadTemplates(dir: string = DEFAULT_TEMPLATES_DIR): TemplateRecord[] {
  return loadTemplateLibrary(dir).records
}

type HubForm = 'ldk' | 'dk' | 'separate' | 'none'

function hubFormOf(rooms: Array<{ type: RoomType; name: string }>): HubForm {
  const combined = rooms.filter(room => room.type === 'living_kitchen')
  if (combined.length === 1) return isDiningKitchenName(combined[0]!.name) ? 'dk' : 'ldk'
  if (combined.length > 1) return 'none'
  return rooms.some(room => room.type === 'living') ? 'separate' : 'none'
}

function countOfType(rooms: Array<{ type: RoomType }>, type: RoomType): number {
  return rooms.filter(room => room.type === type).length
}

// 1R/1K compact single-person units: the corridor (narrow_lot) layout IS the
// canonical built form of the program in the JP market, so a request WITHOUT
// a site constraint may still take such a template — but only for these
// programs and only on an exact program match. Everything else keeps the
// strict rule (an unconstrained 1LDK request must not land on the 4.5×12m
// うなぎの寝床 reference).
const CANONICALLY_CONSTRAINED_PROGRAMS = new Set(['1r', '1k'])

type TemplateMatch =
  | { ok: true; ratio: number; relaxedTypology: boolean }
  | { ok: false; reasons: string[] }

function matchTemplate(
  intent: LayoutIntent,
  template: TemplateRecord,
  strategy?: PartitionStrategyHint & { roomProgram?: string; serviceRoomCount?: number },
  requiredRooms?: Array<{ type: RoomType; count: number }>,
): TemplateMatch {
  const reasons: string[] = []
  const roomProgram = strategy?.roomProgram
  const templateProgram = template.meta.roomProgram
  if (roomProgram && templateProgram && roomProgram !== templateProgram) {
    reasons.push(`roomProgram mismatch: ${roomProgram} != ${templateProgram}`)
  }

  const templateTypology = template.meta.typology
  const strategyConstrained = strategy?.typology !== undefined
    && SITE_CONSTRAINED_TYPOLOGIES.has(strategy.typology)
  const templateConstrained = templateTypology !== undefined
    && SITE_CONSTRAINED_TYPOLOGIES.has(templateTypology)
  let relaxedTypology = false
  if (strategyConstrained !== templateConstrained) {
    const canonicalCompact = templateConstrained && !strategyConstrained
      && roomProgram !== undefined && roomProgram === templateProgram
      && CANONICALLY_CONSTRAINED_PROGRAMS.has(roomProgram)
    if (canonicalCompact) {
      relaxedTypology = true
    } else {
      reasons.push(`typology constraint mismatch: strategy ${strategy?.typology ?? 'none'} vs template ${templateTypology ?? 'none'}`)
    }
  } else if (strategyConstrained && strategy!.typology !== templateTypology) {
    reasons.push(`typology mismatch: ${strategy!.typology} != ${templateTypology}`)
  }

  const intentRooms = intent.rooms
  const templateRooms = template.plan.rooms
  const demandedServiceRooms = strategy?.serviceRoomCount ?? 0
  const templateServiceRooms = templateRooms.filter(
    room => room.type === 'storage' && isServiceRoomName(room.name),
  ).length
  if (templateServiceRooms < demandedServiceRooms) {
    reasons.push(`service room count below floor: template ${templateServiceRooms} < required ${demandedServiceRooms}`)
  }
  if (countOfType(intentRooms, 'bedroom') !== countOfType(templateRooms, 'bedroom')) {
    reasons.push(`bedroom count mismatch: ${countOfType(intentRooms, 'bedroom')} != ${countOfType(templateRooms, 'bedroom')}`)
  }
  if (hubFormOf(intentRooms) !== hubFormOf(templateRooms)) {
    reasons.push(`hubForm mismatch: ${hubFormOf(intentRooms)} != ${hubFormOf(templateRooms)}`)
  }
  // Core rooms must match EXACTLY in both directions — a template must never
  // smuggle in a study/dining the user didn't ask for (they'd keep their
  // template identity, invisible to the intent correspondence).
  for (const type of ['kitchen', 'living', 'dining', 'study', 'other'] as RoomType[]) {
    if (countOfType(intentRooms, type) !== countOfType(templateRooms, type)) {
      reasons.push(`${type} count mismatch: ${countOfType(intentRooms, type)} != ${countOfType(templateRooms, type)}`)
    }
  }
  // Service rooms: the template may be RICHER (卫浴分离/収納/玄関), never
  // poorer — "2 bathrooms requested" must not land on a 1-bathroom template.
  // The floor is the max of the intent's own rooms and the brief-derived
  // requiredRooms counts (which validation deliberately drops later).
  for (const type of SERVICE_TYPES) {
    const required = Math.max(
      countOfType(intentRooms, type),
      requiredRooms?.find(entry => entry.type === type)?.count ?? 0,
    )
    if (countOfType(templateRooms, type) < required) {
      reasons.push(`${type} count below floor: template ${countOfType(templateRooms, type)} < required ${required}`)
    }
  }
  const templateArea = footprintArea(template.plan.footprint)
  if (!(templateArea > 0)) {
    reasons.push('template footprint area is not positive')
    return { ok: false, reasons }
  }
  const ratio = intent.targetTotalAreaSqm / templateArea
  if (ratio < MIN_AREA_RATIO || ratio > MAX_AREA_RATIO) {
    reasons.push(`area ratio out of range: ${ratio.toFixed(2)} not in [${MIN_AREA_RATIO}, ${MAX_AREA_RATIO}]`)
  }
  if (reasons.length > 0) return { ok: false, reasons }
  return { ok: true, ratio, relaxedTypology }
}

// Core (non-service) template rooms take the intent's ids and names so the
// plan↔intent correspondence the modify path and gates rely on holds; the
// template's richer service program keeps its own identity.
function coreRoomRemap(
  intent: LayoutIntent,
  templateRooms: LayoutPlanRoom[],
): Map<string, { id: string; name: string; window?: boolean }> | null {
  const remap = new Map<string, { id: string; name: string; window?: boolean }>()
  const coreTypes: RoomType[] = ['bedroom', 'living_kitchen', 'living', 'kitchen', 'dining', 'study', 'other']
  for (const type of coreTypes) {
    const fromTemplate = templateRooms
      .filter(room => room.type === type)
      .sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))
    const fromIntent = intent.rooms
      .filter(room => room.type === type)
      .sort((a, b) => (b.targetAreaSqm ?? 0) - (a.targetAreaSqm ?? 0))
    for (let i = 0; i < Math.min(fromTemplate.length, fromIntent.length); i++) {
      const target = fromIntent[i]!
      remap.set(fromTemplate[i]!.id, {
        id: target.id,
        name: target.name,
        ...(target.requiresExteriorWindow !== undefined ? { window: target.requiresExteriorWindow } : {}),
      })
    }
  }
  const finalIds = templateRooms.map(room => remap.get(room.id)?.id ?? room.id)
  if (new Set(finalIds).size !== finalIds.length) return null
  return remap
}

function adaptTemplate(
  intent: LayoutIntent,
  template: TemplateRecord,
  ratio: number,
): Omit<TemplateSeedResult, 'validation'> | null {
  const remap = coreRoomRemap(intent, template.plan.rooms)
  if (!remap) return null
  const s = Math.sqrt(ratio)
  const scale = (value: number) => roundCm(value * s)
  const scalePolygon = (polygon: Array<[number, number]>): Array<[number, number]> =>
    polygon.map(([x, z]) => [scale(x), scale(z)])

  const rooms: LayoutPlanRoom[] = template.plan.rooms.map(room => {
    const mapped = remap.get(room.id)
    return {
      ...room,
      id: mapped?.id ?? room.id,
      name: mapped?.name ?? room.name,
      polygon: scalePolygon(room.polygon),
      requiresExteriorWindow: mapped?.window ?? room.requiresExteriorWindow,
    }
  })
  const mappedId = (id: string) => remap.get(id)?.id ?? id
  const plan: LayoutPlan = {
    footprint: {
      width: scale(template.plan.footprint.width),
      depth: scale(template.plan.footprint.depth),
      ...(template.plan.footprint.polygon
        ? { polygon: scalePolygon(template.plan.footprint.polygon) }
        : {}),
    },
    entry: { roomId: mappedId(template.plan.entry.roomId) },
    rooms,
    connections: template.plan.connections.map(connection => ({
      ...connection,
      from: mappedId(connection.from),
      to: mappedId(connection.to),
    })),
  }
  const notes = [
    `复用参照户型「${template.meta.label}」（${template.id}），整体缩放到 ${Math.round(ratio * 100)}%`,
  ]
  if (intent.rooms.some(room => room.targetAreaSqm !== undefined)) {
    notes.push('参照户型的房间比例优先，Intent 中的单房间目标面积未逐间套用')
  }
  return { plan, templateId: template.id, notes }
}

// Returns the adapted plan of the best-matching good reference, or null when
// nothing in the library fits (the partitioner is the fallback, always).
// `targets.requiredRooms` is deliberately dropped from the VALIDATION step —
// the template's service program may be richer than the brief's counts
// (卫浴分离/収納) by design — but its counts DO participate in matching as a
// lower bound (see matchRatio), so richer is allowed and poorer is not.
export function findTemplateSeed(
  intent: LayoutIntent,
  profile: NormProfile,
  strategy?: PartitionStrategyHint & {
    footprintHint?: { widthM: number; depthM: number }
    roomProgram?: string
    serviceRoomCount?: number
  },
  // `trace` collects per-template rejection reasons for the request trace —
  // debug data only, never rendered to users.
  options?: { targets?: PlanTargets; templatesDir?: string; trace?: string[] },
): TemplateSeedResult | null {
  const trace = options?.trace
  if (strategy?.footprintHint) {
    trace?.push('seeding skipped: strategy carries an explicit footprintHint')
    return null
  }
  const { requiredRooms, ...targetRest } = options?.targets ?? {}
  const candidates: Array<{ template: TemplateRecord; ratio: number; relaxedTypology: boolean }> = []
  const library = loadTemplateLibrary(options?.templatesDir)
  for (const failure of library.failures) trace?.push(`template load failure: ${failure}`)
  for (const template of library.records) {
    if (template.meta.quality !== 'good' || template.meta.market !== profile.id) continue
    const match = matchTemplate(intent, template, strategy, requiredRooms)
    if (match.ok) {
      candidates.push({ template, ratio: match.ratio, relaxedTypology: match.relaxedTypology })
    } else {
      trace?.push(`${template.id} rejected: ${match.reasons.join('; ')}`)
    }
  }
  // Typology-consistent hits outrank canonical-form relaxations; area
  // closeness breaks ties.
  candidates.sort((a, b) =>
    Number(a.relaxedTypology) - Number(b.relaxedTypology)
    || Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)))
  for (const { template, ratio } of candidates) {
    const adapted = adaptTemplate(intent, template, ratio)
    if (!adapted) {
      trace?.push(`${template.id} rejected: core-room remap produced duplicate ids`)
      continue
    }
    const validation = validateLayoutPlan(
      adapted.plan,
      { ...targetRest, totalAreaSqm: intent.targetTotalAreaSqm },
      profile,
    )
    if (validation.fatal.length > 0) {
      trace?.push(`${template.id} rejected: post-scale validation fatal: ${validation.fatal.join('; ')}`)
      continue
    }
    return { ...adapted, validation }
  }
  return null
}
