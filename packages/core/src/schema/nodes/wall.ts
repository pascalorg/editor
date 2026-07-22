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

export const WallAssemblyLayerRole = z.enum([
  'structure',
  'interior-finish',
  'exterior-sheathing',
  'exterior-finish',
  'masonry-veneer',
  'air-space',
  'concrete-block',
  'structural-masonry',
  'solid-concrete',
  'furring',
])
export type WallAssemblyLayerRole = z.infer<typeof WallAssemblyLayerRole>

export const WallDimensionDatum = z.enum([
  'centerline',
  'structural-face',
  'finish-face',
  'veneer-face',
])
export type WallDimensionDatum = z.infer<typeof WallDimensionDatum>

export const WallAssemblyLayer = z.object({
  id: z.string().trim().min(1).max(80).default('structure'),
  role: WallAssemblyLayerRole.default('structure'),
  side: z.enum(['core', 'interior', 'exterior']).default('core'),
  thickness: z.number().finite().positive().default(0.1),
  materialRef: z.string().trim().max(120).default(''),
  datumEligible: z.array(WallDimensionDatum).max(8).default([]),
})
export type WallAssemblyLayer = z.infer<typeof WallAssemblyLayer>

export type WallAssemblyDatumSide = 'center' | 'interior' | 'exterior'

export type WallAssemblyDatumReference = {
  id: string
  datum: WallDimensionDatum
  side: WallAssemblyDatumSide
  layerId?: string
  offset: number
}

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
  assemblyLayers: z.array(WallAssemblyLayer).max(32).default([]),
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
  - assemblyLayers: construction layers with role, side, thickness, material reference, and datum eligibility
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

export function getWallAssemblyLayers(wall: Pick<WallNode, 'assemblyLayers'>): WallAssemblyLayer[] {
  return wall.assemblyLayers ?? []
}

export function getWallAssemblyThickness(
  wall: Pick<WallNode, 'assemblyLayers' | 'thickness'>,
): number {
  const layers = wall.assemblyLayers ?? []
  if (layers.length === 0) return wall.thickness ?? 0.1
  return layers.reduce((sum, layer) => sum + layer.thickness, 0)
}

export function getWallAssemblyFaceOffsets(wall: Pick<WallNode, 'assemblyLayers' | 'thickness'>): {
  interior: number
  exterior: number
} {
  const layers = wall.assemblyLayers ?? []
  if (layers.length === 0) {
    const halfThickness = (wall.thickness ?? 0.1) / 2
    return { interior: -halfThickness, exterior: halfThickness }
  }

  const coreLayers = layers.filter((layer) => layer.side === 'core')
  const coreThickness =
    coreLayers.length > 0
      ? coreLayers.reduce((sum, layer) => sum + layer.thickness, 0)
      : (wall.thickness ?? 0.1)
  const interiorFinishThickness = layers
    .filter((layer) => layer.side === 'interior')
    .reduce((sum, layer) => sum + layer.thickness, 0)
  const exteriorFinishThickness = layers
    .filter((layer) => layer.side === 'exterior')
    .reduce((sum, layer) => sum + layer.thickness, 0)

  return {
    interior: -coreThickness / 2 - interiorFinishThickness,
    exterior: coreThickness / 2 + exteriorFinishThickness,
  }
}

export function getWallDatumEligibleLayers(
  wall: Pick<WallNode, 'assemblyLayers'>,
  datum: WallDimensionDatum,
): WallAssemblyLayer[] {
  return (wall.assemblyLayers ?? []).filter((layer) => layer.datumEligible.includes(datum))
}

export function getWallAssemblyDatumReferenceId(
  datum: WallDimensionDatum,
  side: WallAssemblyDatumSide,
  layerId?: string,
): string {
  return ['wall', datum, side, layerId].filter(Boolean).join(':')
}

type WallAssemblyLayerSpan = {
  layer: WallAssemblyLayer
  interiorOffset: number
  exteriorOffset: number
}

function getWallAssemblyLayerSpans(
  wall: Pick<WallNode, 'assemblyLayers' | 'thickness'>,
): WallAssemblyLayerSpan[] {
  const layers = wall.assemblyLayers ?? []
  if (layers.length === 0) return []

  const coreLayers = layers.filter((layer) => layer.side === 'core')
  const coreThickness =
    coreLayers.length > 0
      ? coreLayers.reduce((sum, layer) => sum + layer.thickness, 0)
      : (wall.thickness ?? 0.1)
  const coreInteriorFace = -coreThickness / 2
  const coreExteriorFace = coreThickness / 2
  const spans: WallAssemblyLayerSpan[] = []

  let coreOffset = coreInteriorFace
  for (const layer of coreLayers) {
    const interiorOffset = coreOffset
    const exteriorOffset = coreOffset + layer.thickness
    spans.push({ layer, interiorOffset, exteriorOffset })
    coreOffset = exteriorOffset
  }

  let interiorOffset = coreInteriorFace
  for (const layer of layers.filter((candidate) => candidate.side === 'interior')) {
    const exteriorOffset = interiorOffset
    const nextInteriorOffset = exteriorOffset - layer.thickness
    spans.push({ layer, interiorOffset: nextInteriorOffset, exteriorOffset })
    interiorOffset = nextInteriorOffset
  }

  let exteriorOffset = coreExteriorFace
  for (const layer of layers.filter((candidate) => candidate.side === 'exterior')) {
    const interiorFaceOffset = exteriorOffset
    const nextExteriorOffset = interiorFaceOffset + layer.thickness
    spans.push({ layer, interiorOffset: interiorFaceOffset, exteriorOffset: nextExteriorOffset })
    exteriorOffset = nextExteriorOffset
  }

  return spans
}

function createWallAssemblyDatumReference(
  datum: WallDimensionDatum,
  side: WallAssemblyDatumSide,
  offset: number,
  layerId?: string,
): WallAssemblyDatumReference {
  return {
    id: getWallAssemblyDatumReferenceId(datum, side, layerId),
    datum,
    side,
    ...(layerId ? { layerId } : {}),
    offset,
  }
}

export function resolveWallAssemblyDatumReferences(
  wall: Pick<WallNode, 'assemblyLayers' | 'thickness'>,
): WallAssemblyDatumReference[] {
  const layers = wall.assemblyLayers ?? []
  const references: WallAssemblyDatumReference[] = [
    createWallAssemblyDatumReference('centerline', 'center', 0),
  ]

  if (layers.length === 0) {
    const halfThickness = (wall.thickness ?? 0.1) / 2
    return [
      ...references,
      createWallAssemblyDatumReference('structural-face', 'interior', -halfThickness),
      createWallAssemblyDatumReference('structural-face', 'exterior', halfThickness),
      createWallAssemblyDatumReference('finish-face', 'interior', -halfThickness),
      createWallAssemblyDatumReference('finish-face', 'exterior', halfThickness),
    ]
  }

  const spans = getWallAssemblyLayerSpans(wall)

  for (const span of spans) {
    if (span.layer.datumEligible.includes('structural-face')) {
      if (span.layer.side === 'core') {
        references.push(
          createWallAssemblyDatumReference(
            'structural-face',
            'interior',
            span.interiorOffset,
            span.layer.id,
          ),
          createWallAssemblyDatumReference(
            'structural-face',
            'exterior',
            span.exteriorOffset,
            span.layer.id,
          ),
        )
      } else {
        const side = span.layer.side
        references.push(
          createWallAssemblyDatumReference(
            'structural-face',
            side,
            side === 'interior' ? span.interiorOffset : span.exteriorOffset,
            span.layer.id,
          ),
        )
      }
    }

    if (span.layer.datumEligible.includes('finish-face')) {
      const side = span.layer.side === 'core' ? 'center' : span.layer.side
      const offset =
        span.layer.side === 'interior'
          ? span.interiorOffset
          : span.layer.side === 'exterior'
            ? span.exteriorOffset
            : (span.interiorOffset + span.exteriorOffset) / 2
      references.push(createWallAssemblyDatumReference('finish-face', side, offset, span.layer.id))
    }

    if (span.layer.datumEligible.includes('veneer-face')) {
      const side = span.layer.side === 'interior' ? 'interior' : 'exterior'
      const offset = side === 'interior' ? span.interiorOffset : span.exteriorOffset
      references.push(createWallAssemblyDatumReference('veneer-face', side, offset, span.layer.id))
    }
  }

  if (!references.some((reference) => reference.datum === 'structural-face')) {
    const halfThickness = getWallAssemblyThickness(wall) / 2
    references.push(
      createWallAssemblyDatumReference('structural-face', 'interior', -halfThickness),
      createWallAssemblyDatumReference('structural-face', 'exterior', halfThickness),
    )
  }

  if (!references.some((reference) => reference.datum === 'finish-face')) {
    const halfThickness = getWallAssemblyThickness(wall) / 2
    references.push(
      createWallAssemblyDatumReference('finish-face', 'interior', -halfThickness),
      createWallAssemblyDatumReference('finish-face', 'exterior', halfThickness),
    )
  }

  return references
}

export function resolveWallAssemblyDatumReference(
  wall: Pick<WallNode, 'assemblyLayers' | 'thickness'>,
  referenceId: string,
): WallAssemblyDatumReference | null {
  return (
    resolveWallAssemblyDatumReferences(wall).find((reference) => reference.id === referenceId) ??
    null
  )
}

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
