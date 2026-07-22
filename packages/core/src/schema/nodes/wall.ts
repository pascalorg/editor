import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { WindowNode } from './window'

export const WallTreatmentSide = z.enum(['interior', 'exterior', 'both'])
export type WallTreatmentSide = z.infer<typeof WallTreatmentSide>

export const WallTrimProfile = z.enum([
  'flat',
  'bevel',
  'triangle',
  'cove',
  'bullnose',
  'base-modern',
  'base-colonial',
  'base-shoe',
  'base-ogee',
  'crown-cove',
  'crown-ogee',
  'crown-craftsman',
  'crown-layered',
  'rail-rounded',
  'rail-ogee',
  'rail-picture',
  'rail-stepped',
])
export type WallTrimProfile = z.infer<typeof WallTrimProfile>

export const WallTrimConfig = z.object({
  enabled: z.boolean().default(false),
  sides: WallTreatmentSide.default('both'),
  height: z.number().default(0.1),
  proud: z.number().default(0.015),
  profile: WallTrimProfile.default('flat'),
  offsetY: z.number().optional(),
})
export type WallTrimConfig = z.infer<typeof WallTrimConfig>

export const WALL_SKIRTING_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.12,
  proud: 0.02,
  profile: 'flat',
}

export const WALL_CROWN_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.12,
  proud: 0.055,
  profile: 'flat',
}

export const WALL_CHAIR_RAIL_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.055,
  proud: 0.026,
  profile: 'flat',
  offsetY: 0.9,
}

export const WALL_TRIM_DEFAULTS = {
  skirting: WALL_SKIRTING_DEFAULT,
  crown: WALL_CROWN_DEFAULT,
  chairRail: WALL_CHAIR_RAIL_DEFAULT,
} as const

const WallFaceBandConfigShape = z.object({
  enabled: z.boolean().default(false),
  count: z.number().int().min(1).max(4).default(1),
  lowerHeight: z.number().default(0.84),
  middleHeight: z.number().default(0.61),
  upperHeight: z.number().default(0.61),
})

export const WallFaceBandConfig = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('count' in value)) {
    const enabled = (value as { enabled?: unknown }).enabled === true
    return { ...value, count: enabled ? 3 : 1 }
  }
  return value
}, WallFaceBandConfigShape)
export type WallFaceBandConfig = z.infer<typeof WallFaceBandConfig>

export const WALL_FACE_BAND_DEFAULT: WallFaceBandConfig = {
  enabled: false,
  count: 1,
  lowerHeight: 0.84,
  middleHeight: 0.61,
  upperHeight: 0.61,
}

export const WALL_SKIRTING_SLOT_DEFAULT = 'library:preset-softwhite'
export const WALL_CROWN_SLOT_DEFAULT = 'library:preset-white'
export const WALL_CHAIR_RAIL_SLOT_DEFAULT = 'library:preset-cream'
export const WALL_FACE_BAND_SOLID_SLOT_DEFAULTS = {
  lower: 'library:preset-white',
  middle: 'library:preset-lightgrey',
  upper: 'library:preset-greige',
  top: 'library:preset-softwhite',
} as const satisfies Record<WallFaceBand, string>

export const WALL_SURFACE_SLOT_DEFAULTS = {
  interior: 'library:concrete-drywall',
  exterior: 'library:concrete-drywall',
  lowerInterior: 'library:concrete-drywall',
  middleInterior: 'library:concrete-drywall',
  upperInterior: 'library:concrete-drywall',
  topInterior: 'library:concrete-drywall',
  lowerExterior: 'library:concrete-drywall',
  middleExterior: 'library:concrete-drywall',
  upperExterior: 'library:concrete-drywall',
  topExterior: 'library:concrete-drywall',
  skirtingInterior: WALL_SKIRTING_SLOT_DEFAULT,
  skirtingExterior: WALL_SKIRTING_SLOT_DEFAULT,
  crownInterior: WALL_CROWN_SLOT_DEFAULT,
  crownExterior: WALL_CROWN_SLOT_DEFAULT,
  chairRailInterior: WALL_CHAIR_RAIL_SLOT_DEFAULT,
  chairRailExterior: WALL_CHAIR_RAIL_SLOT_DEFAULT,
} as const

export type WallSurfaceSlotId = keyof typeof WALL_SURFACE_SLOT_DEFAULTS

export const WallNode = BaseNode.extend({
  id: objectId('wall'),
  type: nodeType('wall'),
  children: z
    .array(z.union([ItemNode.shape.id, DoorNode.shape.id, WindowNode.shape.id]))
    .default([]),
  // Legacy single-material wall finish. Read for backward compatibility only.
  material: MaterialSchema.optional(),
  // Legacy single-material wall finish preset. Read for backward compatibility only.
  materialPreset: z.string().optional(),
  interiorMaterial: MaterialSchema.optional(),
  interiorMaterialPreset: z.string().optional(),
  exteriorMaterial: MaterialSchema.optional(),
  exteriorMaterialPreset: z.string().optional(),
  // Per-slot material overrides on the unified slot model, mirroring
  // `SlabNode.slots`. Key = slot id (`interior` / `exterior`), value = a
  // `MaterialRef` (`library:<id>` / `scene:<id>`). Absent = the declared slot
  // default (`WALL_SLOT_DEFAULT`). The legacy `*Material*` fields above are
  // read only by the load migration that moves them into `slots`; delete them
  // in a follow-up once migrated scenes are the norm.
  slots: z.record(z.string(), z.string()).optional(),
  thickness: z.number().optional(),
  height: z.number().optional(),
  curveOffset: z.number().optional(),
  // Persisted slab-support host — see ItemNode.supportSlabId for the rules.
  supportSlabId: z.string().optional(),
  faceBands: WallFaceBandConfig.optional(),
  skirting: WallTrimConfig.optional(),
  crown: WallTrimConfig.optional(),
  chairRail: WallTrimConfig.optional(),
  // e.g., start/end points for path
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  // Space detection for cutaway mode
  frontSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
  backSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
}).describe(
  dedent`
  Wall node - used to represent a wall in the building
  - thickness: thickness in meters
  - height: height in meters
  - curveOffset: midpoint sagitta offset used to bend the wall into an arc
  - start: start point of the wall in level coordinate system
  - end: end point of the wall in level coordinate system
  - size: size of the wall in grid units
  - frontSide: whether the front side faces interior, exterior, or unknown
  - backSide: whether the back side faces interior, exterior, or unknown
  `,
)
export type WallNode = z.infer<typeof WallNode>

export type WallSurfaceSide = 'interior' | 'exterior'
export type WallFaceBand = 'lower' | 'middle' | 'upper' | 'top'
export type WallBandSurfaceSlotId =
  | 'lowerInterior'
  | 'middleInterior'
  | 'upperInterior'
  | 'topInterior'
  | 'lowerExterior'
  | 'middleExterior'
  | 'upperExterior'
  | 'topExterior'

// Declared default appearance for an unpainted wall face in colored mode —
// visual parity with the retired DEFAULT_WALL_MATERIAL. Lives in core so the
// slot declaration (nodes) and the material resolver (viewer) share one value.
// May be a `#rrggbb` colour or a `library:<id>` ref. Textures-off still
// collapses to the themed wall role (the escape hatch).
export const WALL_SLOT_DEFAULT: Record<WallSurfaceSide, string> = {
  interior: WALL_SURFACE_SLOT_DEFAULTS.interior,
  exterior: WALL_SURFACE_SLOT_DEFAULTS.exterior,
}

export function getWallFaceBandConfig(
  wall: Pick<WallNode, 'height' | 'faceBands'>,
  effectiveWallHeight: number,
) {
  const wallHeight = Math.max(0, effectiveWallHeight)
  const raw = { ...WALL_FACE_BAND_DEFAULT, ...(wall.faceBands ?? {}) }
  const count = raw.enabled ? Math.max(1, Math.min(4, Math.round(raw.count ?? 3))) : 1
  const lowerHeight = count >= 2 ? Math.max(0, Math.min(wallHeight, raw.lowerHeight)) : 0
  const middleHeight =
    count >= 3 ? Math.max(0, Math.min(wallHeight - lowerHeight, raw.middleHeight)) : 0
  const upperHeight =
    count >= 4 ? Math.max(0, Math.min(wallHeight - lowerHeight - middleHeight, raw.upperHeight)) : 0

  return {
    enabled: raw.enabled && count > 1,
    count,
    lowerHeight,
    middleHeight,
    upperHeight,
    lowerTop: lowerHeight,
    middleTop: lowerHeight + middleHeight,
    upperTop: lowerHeight + middleHeight + upperHeight,
  }
}

export function getWallFaceBandForHeight(
  wall: Pick<WallNode, 'height' | 'faceBands'>,
  y: number,
  effectiveWallHeight: number,
): WallFaceBand {
  const bands = getWallFaceBandConfig(wall, effectiveWallHeight)
  if (!bands.enabled) return 'upper'
  if (y < bands.lowerTop) return 'lower'
  if (y < bands.middleTop) return 'middle'
  if (bands.count >= 4 && y < bands.upperTop) return 'upper'
  if (bands.count >= 4) return 'top'
  return 'upper'
}

export function getWallBandSlotId(
  side: WallSurfaceSide,
  band: WallFaceBand,
): WallBandSurfaceSlotId {
  const suffix = side === 'interior' ? 'Interior' : 'Exterior'
  return `${band}${suffix}` as WallBandSurfaceSlotId
}

const WALL_FACE_BAND_SLOTS_BY_SIDE = {
  interior: ['lowerInterior', 'middleInterior', 'upperInterior', 'topInterior'],
  exterior: ['lowerExterior', 'middleExterior', 'upperExterior', 'topExterior'],
} as const satisfies Record<WallSurfaceSide, readonly WallBandSurfaceSlotId[]>

function getWallFaceBandSlotsForCount(
  side: WallSurfaceSide,
  count: number,
): readonly WallBandSurfaceSlotId[] {
  if (count <= 1) return []
  if (side === 'interior') {
    if (count === 2) return ['lowerInterior', 'upperInterior']
    if (count === 3) return ['lowerInterior', 'middleInterior', 'upperInterior']
    return ['lowerInterior', 'middleInterior', 'upperInterior', 'topInterior']
  }

  if (count === 2) return ['lowerExterior', 'upperExterior']
  if (count === 3) return ['lowerExterior', 'middleExterior', 'upperExterior']
  return ['lowerExterior', 'middleExterior', 'upperExterior', 'topExterior']
}

function getWallFaceBandDefaultSlot(slotId: WallBandSurfaceSlotId): string {
  if (slotId.startsWith('lower')) return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower
  if (slotId.startsWith('middle')) return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle
  if (slotId.startsWith('top')) return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.top
  return WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper
}

function getWallFaceTopBandSlot(
  side: WallSurfaceSide,
  count: number,
): WallBandSurfaceSlotId | null {
  const slots = getWallFaceBandSlotsForCount(side, count)
  return slots[slots.length - 1] ?? null
}

export function buildWallFaceBandCountPatch(
  wall: Pick<WallNode, 'faceBands' | 'slots'>,
  count: number,
): Pick<WallNode, 'faceBands' | 'slots'> {
  const slots = { ...(wall.slots ?? {}) }
  const nextCount = Math.max(1, Math.min(4, Math.round(count)))
  const previousCount = wall.faceBands?.enabled
    ? Math.max(1, Math.min(4, Math.round(wall.faceBands.count ?? 3)))
    : 1

  for (const side of ['interior', 'exterior'] as const) {
    const nextSlots = getWallFaceBandSlotsForCount(side, nextCount)
    const activeSlots = new Set(nextSlots)
    const previouslyActiveSlots = new Set(getWallFaceBandSlotsForCount(side, previousCount))
    const previousTopSlot = getWallFaceTopBandSlot(side, previousCount)
    const nextTopSlot = getWallFaceTopBandSlot(side, nextCount)
    const topMaterial =
      (previousTopSlot ? slots[previousTopSlot] : undefined) ??
      slots[side] ??
      WALL_SURFACE_SLOT_DEFAULTS[side]
    for (const slotId of WALL_FACE_BAND_SLOTS_BY_SIDE[side]) {
      if (activeSlots.has(slotId)) {
        if (slotId === nextTopSlot) {
          slots[slotId] = topMaterial
          continue
        }
        const wasActive = previouslyActiveSlots.has(slotId)
        const wasPreviousTop = slotId === previousTopSlot
        if (!wasActive || wasPreviousTop || !slots[slotId]) {
          slots[slotId] = getWallFaceBandDefaultSlot(slotId)
        }
      } else {
        delete slots[slotId]
      }
    }
  }

  return {
    faceBands: {
      ...WALL_FACE_BAND_DEFAULT,
      ...(wall.faceBands ?? {}),
      enabled: nextCount > 1,
      count: nextCount,
      lowerHeight: wall.faceBands?.lowerHeight ?? WALL_FACE_BAND_DEFAULT.lowerHeight,
      middleHeight: wall.faceBands?.middleHeight ?? WALL_FACE_BAND_DEFAULT.middleHeight,
      upperHeight: wall.faceBands?.upperHeight ?? WALL_FACE_BAND_DEFAULT.upperHeight,
    },
    slots,
  }
}

export function buildEnabledWallFaceBandPatch(
  wall: Pick<WallNode, 'faceBands' | 'slots'>,
): Pick<WallNode, 'faceBands' | 'slots'> {
  return buildWallFaceBandCountPatch(wall, 2)
}

export function getWallSurfaceSideFromBandSlot(slotId: string): WallSurfaceSide | null {
  if (slotId === 'interior' || slotId === 'exterior') return slotId
  if (
    slotId === 'lowerInterior' ||
    slotId === 'middleInterior' ||
    slotId === 'upperInterior' ||
    slotId === 'topInterior'
  ) {
    return 'interior'
  }
  if (
    slotId === 'lowerExterior' ||
    slotId === 'middleExterior' ||
    slotId === 'upperExterior' ||
    slotId === 'topExterior'
  ) {
    return 'exterior'
  }
  return null
}

export type WallSurfaceMaterialSpec = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
}

type WallSurfaceMaterialSource = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
  interiorMaterial?: z.infer<typeof MaterialSchema>
  interiorMaterialPreset?: string
  exteriorMaterial?: z.infer<typeof MaterialSchema>
  exteriorMaterialPreset?: string
}

function getConfiguredWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  if (side === 'interior') {
    return {
      material: wall.interiorMaterial,
      materialPreset: wall.interiorMaterialPreset,
    }
  }

  return {
    material: wall.exteriorMaterial,
    materialPreset: wall.exteriorMaterialPreset,
  }
}

function hasSurfaceMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return spec.material !== undefined || typeof spec.materialPreset === 'string'
}

export function getEffectiveWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  const configured = getConfiguredWallSurfaceMaterial(wall, side)
  if (hasSurfaceMaterial(configured)) {
    return configured
  }

  return {
    material: wall.material,
    materialPreset: wall.materialPreset,
  }
}

export function getWallSurfaceMaterialSignature(spec: WallSurfaceMaterialSpec): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}
