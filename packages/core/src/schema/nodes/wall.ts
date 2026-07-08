import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { WindowNode } from './window'

export const WallTreatmentSide = z.enum(['interior', 'exterior', 'both'])
export type WallTreatmentSide = z.infer<typeof WallTreatmentSide>

export const WallTrimProfile = z.enum(['flat', 'bevel', 'triangle', 'cove', 'bullnose'])
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
  height: 0.1,
  proud: 0.015,
  profile: 'flat',
}

export const WALL_CROWN_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.08,
  proud: 0.04,
  profile: 'cove',
}

export const WALL_CHAIR_RAIL_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.04,
  proud: 0.018,
  profile: 'bullnose',
  offsetY: 0.9,
}

export const WALL_TRIM_DEFAULTS = {
  skirting: WALL_SKIRTING_DEFAULT,
  crown: WALL_CROWN_DEFAULT,
  chairRail: WALL_CHAIR_RAIL_DEFAULT,
} as const

export const WallFaceBandConfig = z.object({
  enabled: z.boolean().default(false),
  lowerHeight: z.number().default(0.84),
  middleHeight: z.number().default(0.61),
})
export type WallFaceBandConfig = z.infer<typeof WallFaceBandConfig>

export const WALL_FACE_BAND_DEFAULT: WallFaceBandConfig = {
  enabled: false,
  lowerHeight: 0.84,
  middleHeight: 0.61,
}

export const WALL_SURFACE_SLOT_DEFAULTS = {
  interior: 'library:concrete-drywall',
  exterior: 'library:concrete-drywall',
  lowerInterior: 'library:concrete-drywall',
  middleInterior: 'library:concrete-drywall',
  upperInterior: 'library:concrete-drywall',
  lowerExterior: 'library:concrete-drywall',
  middleExterior: 'library:concrete-drywall',
  upperExterior: 'library:concrete-drywall',
  skirtingInterior: 'library:concrete-drywall',
  skirtingExterior: 'library:concrete-drywall',
  crownInterior: 'library:concrete-drywall',
  crownExterior: 'library:concrete-drywall',
  chairRailInterior: 'library:concrete-drywall',
  chairRailExterior: 'library:concrete-drywall',
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
export type WallFaceBand = 'lower' | 'middle' | 'upper'
export type WallBandSurfaceSlotId =
  | 'lowerInterior'
  | 'middleInterior'
  | 'upperInterior'
  | 'lowerExterior'
  | 'middleExterior'
  | 'upperExterior'

// Declared default appearance for an unpainted wall face in colored mode —
// visual parity with the retired DEFAULT_WALL_MATERIAL. Lives in core so the
// slot declaration (nodes) and the material resolver (viewer) share one value.
// May be a `#rrggbb` colour or a `library:<id>` ref. Textures-off still
// collapses to the themed wall role (the escape hatch).
export const WALL_SLOT_DEFAULT: Record<WallSurfaceSide, string> = {
  interior: WALL_SURFACE_SLOT_DEFAULTS.interior,
  exterior: WALL_SURFACE_SLOT_DEFAULTS.exterior,
}

export function getWallFaceBandConfig(wall: Pick<WallNode, 'height' | 'faceBands'>) {
  const wallHeight = wall.height ?? 2.5
  const raw = { ...WALL_FACE_BAND_DEFAULT, ...(wall.faceBands ?? {}) }
  const lowerHeight = Math.max(0, Math.min(wallHeight, raw.lowerHeight))
  const middleHeight = raw.enabled
    ? Math.max(0, Math.min(wallHeight - lowerHeight, raw.middleHeight))
    : 0

  return {
    enabled: raw.enabled,
    lowerHeight,
    middleHeight,
    lowerTop: lowerHeight,
    middleTop: lowerHeight + middleHeight,
  }
}

export function getWallFaceBandForHeight(
  wall: Pick<WallNode, 'height' | 'faceBands'>,
  y: number,
): WallFaceBand {
  const bands = getWallFaceBandConfig(wall)
  if (!bands.enabled) return 'upper'
  if (y < bands.lowerTop) return 'lower'
  if (y < bands.middleTop) return 'middle'
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
  interior: ['lowerInterior', 'middleInterior', 'upperInterior'],
  exterior: ['lowerExterior', 'middleExterior', 'upperExterior'],
} as const satisfies Record<WallSurfaceSide, readonly WallBandSurfaceSlotId[]>

export function buildEnabledWallFaceBandPatch(
  wall: Pick<WallNode, 'faceBands' | 'slots'>,
): Pick<WallNode, 'faceBands' | 'slots'> {
  const slots = { ...(wall.slots ?? {}) }

  for (const side of ['interior', 'exterior'] as const) {
    const sourceRef = slots[side]
    for (const slotId of WALL_FACE_BAND_SLOTS_BY_SIDE[side]) {
      if (sourceRef) slots[slotId] = sourceRef
      else delete slots[slotId]
    }
  }

  return {
    faceBands: {
      ...WALL_FACE_BAND_DEFAULT,
      ...(wall.faceBands ?? {}),
      enabled: true,
      lowerHeight: WALL_FACE_BAND_DEFAULT.lowerHeight,
      middleHeight: WALL_FACE_BAND_DEFAULT.middleHeight,
    },
    slots,
  }
}

export function getWallSurfaceSideFromBandSlot(slotId: string): WallSurfaceSide | null {
  if (slotId === 'interior' || slotId === 'exterior') return slotId
  if (slotId === 'lowerInterior' || slotId === 'middleInterior' || slotId === 'upperInterior') {
    return 'interior'
  }
  if (slotId === 'lowerExterior' || slotId === 'middleExterior' || slotId === 'upperExterior') {
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
