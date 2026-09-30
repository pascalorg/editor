import type { WallFace, WallFaceRegion } from '../schema/nodes/wall'
import { loadMigration } from './load-migration'

// Load migrations M1 and M2 of the room-first structure plan. Both are pure,
// idempotent and server-safe: they read and write plain node records only.
//
// M1 re-keys wall finishes from semantic sides (`interior` / `exterior`) onto
// geometric faces (`a` = left of start → end, `b` = right), using the side the
// wall stored when it was saved — exactly the mapping the renderer applied:
// an unknown or corrupt side falls back to front → interior, back → exterior.
//
// M2 turns enabled face bands into full-width horizontal paint regions with
// the same heights and finishes, then drops `faceBands`.

type RawNode = Record<string, unknown>
type LegacySide = 'interior' | 'exterior'

const LEGACY_SUFFIX: Record<LegacySide, 'Interior' | 'Exterior'> = {
  interior: 'Interior',
  exterior: 'Exterior',
}
const BANDS = ['lower', 'middle', 'upper', 'top'] as const
type Band = (typeof BANDS)[number]
const BAND_SUFFIX: Record<Band, string> = {
  lower: 'Lower',
  middle: 'Middle',
  upper: 'Upper',
  top: 'Top',
}
const TRIMS = [
  ['skirting', 'Skirting'],
  ['crown', 'Crown'],
  ['chairRail', 'ChairRail'],
] as const
const LEGACY_MATERIAL_KEYS = [
  'interiorMaterial',
  'interiorMaterialPreset',
  'exteriorMaterial',
  'exteriorMaterialPreset',
] as const

const SEMANTIC_SLOT_KEYS = new Set<string>([
  'interior',
  'exterior',
  'front',
  'back',
  ...BANDS.flatMap((band) => [`${band}Interior`, `${band}Exterior`]),
  ...TRIMS.flatMap(([kind]) => [`${kind}Interior`, `${kind}Exterior`]),
])

/** Band slot keys M1 emits for M2 to consume (`aLower` … `bTop`). */
export function wallBandSlotKey(face: WallFace, band: Band): string {
  return `${face}${BAND_SUFFIX[band]}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function slotRecord(node: RawNode): Record<string, unknown> {
  return isRecord(node.slots) ? node.slots : {}
}

function hasRef(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The side a face showed: the stored classification, else front → interior, back → exterior. */
function legacyFaceSide(node: RawNode, face: WallFace): LegacySide {
  const stored = face === 'a' ? node.frontSide : node.backSide
  if (stored === 'interior' || stored === 'exterior') return stored
  return face === 'a' ? 'interior' : 'exterior'
}

/** The face a legacy trim side drew on (the treatment renderer's side sign). */
function legacyTrimFace(node: RawNode, side: LegacySide): WallFace {
  if (node.frontSide === side) return 'a'
  if (node.backSide === side) return 'b'
  return side === 'interior' ? 'a' : 'b'
}

function trimSides(config: unknown): unknown {
  return isRecord(config) ? config.sides : undefined
}

function needsFaceKeyMigration(node: RawNode): boolean {
  if (Object.keys(slotRecord(node)).some((key) => SEMANTIC_SLOT_KEYS.has(key))) return true
  if (LEGACY_MATERIAL_KEYS.some((key) => node[key] !== undefined)) return true
  return TRIMS.some(([kind]) => {
    const sides = trimSides(node[kind])
    return sides === 'interior' || sides === 'exterior'
  })
}

function hasLegacyMaterial(spec: { material?: unknown; materialPreset?: unknown }) {
  return spec.material !== undefined || typeof spec.materialPreset === 'string'
}

function migrateWallNode(node: RawNode): RawNode {
  const source = slotRecord(node)
  const slots: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!SEMANTIC_SLOT_KEYS.has(key)) slots[key] = value
  }
  const put = (key: string, value: unknown) => {
    if (!hasRef(slots[key]) && hasRef(value)) slots[key] = value
  }
  const faceSide = { a: legacyFaceSide(node, 'a'), b: legacyFaceSide(node, 'b') }

  for (const face of ['a', 'b'] as const) {
    const suffix = LEGACY_SUFFIX[faceSide[face]]
    put(face, source[faceSide[face]])
    for (const band of BANDS) put(wallBandSlotKey(face, band), source[`${band}${suffix}`])
  }

  const next: RawNode = { ...node }
  for (const [kind, suffix] of TRIMS) {
    const sides = trimSides(node[kind])
    const interiorFace = legacyTrimFace(node, 'interior')
    const exteriorFace = legacyTrimFace(node, 'exterior')
    // Drawn sides claim their face first. When both legacy sides drew on one
    // face (a degenerate side pair), that face keeps the interior trim and the
    // other face — which `both` now also draws — takes the exterior one.
    const order: LegacySide[] =
      sides === 'exterior' ? ['exterior', 'interior'] : ['interior', 'exterior']
    for (const side of order) {
      put(
        `${side === 'interior' ? interiorFace : exteriorFace}${suffix}`,
        source[`${kind}${LEGACY_SUFFIX[side]}`],
      )
    }
    if (interiorFace === exteriorFace)
      put(`${interiorFace === 'a' ? 'b' : 'a'}${suffix}`, source[`${kind}Exterior`])
    if (sides === 'interior' || sides === 'exterior') {
      next[kind] = {
        ...(node[kind] as Record<string, unknown>),
        sides: sides === 'interior' ? interiorFace : exteriorFace,
      }
    }
  }

  // Stray geometric aliases written by older tools: only fill a face M1 left empty.
  put('a', source.front)
  put('b', source.back)

  const legacyFaceMaterials: Record<string, unknown> = isRecord(node.legacyFaceMaterials)
    ? { ...node.legacyFaceMaterials }
    : {}
  for (const face of ['a', 'b'] as const) {
    if (hasRef(slots[face]) || legacyFaceMaterials[face] !== undefined) continue
    const side = faceSide[face]
    const spec = {
      material: node[`${side}Material`],
      materialPreset: node[`${side}MaterialPreset`],
    }
    if (!hasLegacyMaterial(spec)) continue
    legacyFaceMaterials[face] = Object.fromEntries(
      Object.entries(spec).filter(([, value]) => value !== undefined),
    )
  }

  for (const key of LEGACY_MATERIAL_KEYS) delete next[key]
  if (Object.keys(slots).length > 0 || node.slots !== undefined) next.slots = slots
  if (Object.keys(legacyFaceMaterials).length > 0) next.legacyFaceMaterials = legacyFaceMaterials
  return next
}

/**
 * M1: wall slot keys `interior` / `exterior` (and their band and trim variants,
 * plus stray `front` / `back`) become geometric `a` / `b` keys; legacy inline
 * side finishes move to `legacyFaceMaterials`; single-sided trims name a face.
 * The resolved finish of every face is unchanged.
 */
function migrateWallFaceKeysOnView(sourceNodes: Record<string, unknown>) {
  let nodes: Record<string, unknown> | null = null
  for (const [id, node] of Object.entries(sourceNodes)) {
    if (!isRecord(node) || node.type !== 'wall' || !needsFaceKeyMigration(node)) continue
    nodes ??= { ...sourceNodes }
    nodes[id] = migrateWallNode(node)
  }
  return { nodes: nodes ?? sourceNodes, changed: nodes !== null }
}

type RawBands = {
  enabled?: unknown
  count?: unknown
  lowerHeight?: unknown
  middleHeight?: unknown
  upperHeight?: unknown
}

const BAND_DEFAULTS = { lowerHeight: 0.84, middleHeight: 0.61, upperHeight: 0.61 }

function finiteHeight(value: unknown, fallback: number) {
  return Math.max(0, typeof value === 'number' && Number.isFinite(value) ? value : fallback)
}

/** Band count the renderer drew for a stored config (1 = no bands). */
function drawnBandCount(raw: RawBands): number {
  if (raw.enabled !== true) return 1
  const count = raw.count === undefined ? 1 : raw.count
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1
  return Math.max(1, Math.min(4, Math.round(count)))
}

function bandRegions(node: RawNode, slots: Record<string, unknown>): WallFaceRegion[] {
  const raw = (isRecord(node.faceBands) ? node.faceBands : {}) as RawBands
  const count = drawnBandCount(raw)
  if (count < 2) return []
  const lower = finiteHeight(raw.lowerHeight, BAND_DEFAULTS.lowerHeight)
  const middle = count >= 3 ? finiteHeight(raw.middleHeight, BAND_DEFAULTS.middleHeight) : 0
  const upper = count >= 4 ? finiteHeight(raw.upperHeight, BAND_DEFAULTS.upperHeight) : 0
  const bounds: Array<[Band, number | undefined, number | undefined]> =
    count === 2
      ? [
          ['lower', undefined, lower],
          ['upper', lower, undefined],
        ]
      : count === 3
        ? [
            ['lower', undefined, lower],
            ['middle', lower, lower + middle],
            ['upper', lower + middle, undefined],
          ]
        : [
            ['lower', undefined, lower],
            ['middle', lower, lower + middle],
            ['upper', lower + middle, lower + middle + upper],
            ['top', lower + middle + upper, undefined],
          ]
  const regions: WallFaceRegion[] = []
  for (const face of ['a', 'b'] as const) {
    for (const [band, v0, v1] of bounds) {
      const finish = slots[wallBandSlotKey(face, band)]
      // An unpainted band showed the face finish, which is what shows without a region.
      if (!hasRef(finish)) continue
      if (v0 !== undefined && v1 !== undefined && v1 <= v0) continue
      regions.push({
        id: `band-${face}-${band}`,
        face,
        ...(v0 === undefined ? {} : { v0 }),
        ...(v1 === undefined ? {} : { v1 }),
        finish,
      })
    }
  }
  return regions
}

const BAND_SLOT_KEYS = new Set<string>(
  (['a', 'b'] as const).flatMap((face) => BANDS.map((band) => wallBandSlotKey(face, band))),
)

/**
 * M2: enabled face bands (2–4) become full-width horizontal `faceRegions` with
 * the same heights and finishes; `faceBands` and the band slot keys are dropped.
 * Runs after M1 (it reads the geometric band keys M1 writes).
 */
function migrateWallFaceBandsOnView(sourceNodes: Record<string, unknown>) {
  let nodes: Record<string, unknown> | null = null
  for (const [id, node] of Object.entries(sourceNodes)) {
    if (!isRecord(node) || node.type !== 'wall') continue
    const slots = slotRecord(node)
    const bandKeys = Object.keys(slots).filter((key) => BAND_SLOT_KEYS.has(key))
    if (node.faceBands === undefined && !('faceBands' in node) && bandKeys.length === 0) continue
    const regions = bandRegions(node, slots)
    const next: RawNode = { ...node }
    delete next.faceBands
    if (bandKeys.length > 0) {
      next.slots = Object.fromEntries(
        Object.entries(slots).filter(([key]) => !BAND_SLOT_KEYS.has(key)),
      )
    }
    if (regions.length > 0) {
      const existing = Array.isArray(node.faceRegions) ? node.faceRegions : []
      next.faceRegions = [...regions, ...existing]
    }
    nodes ??= { ...sourceNodes }
    nodes[id] = next
  }
  return { nodes: nodes ?? sourceNodes, changed: nodes !== null }
}

export const migrateWallFaceKeys = loadMigration(
  'wall face keys',
  migrateWallFaceKeysOnView,
  (nodes) => ({ nodes, changed: false }),
)

export const migrateWallFaceBands = loadMigration(
  'wall face bands',
  migrateWallFaceBandsOnView,
  (nodes) => ({ nodes, changed: false }),
)
