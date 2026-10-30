import { z } from 'zod'

/**
 * Typed layer build-ups for roof planes and ceilings: each layer is a product
 * choice (a roofing, a sheathing, a framing size at a spacing) rather than an
 * F2 layer list, so framing tools read the structure they frame and the
 * inspector edits choices, not strings. Thicknesses are metres; spacings are
 * metres on centre.
 */

const Thickness = z.number().finite().nonnegative()
/** What the person calls a layer's material where the kind's own name won't do ("Brazilian cherry"). */
const LayerName = z.string().trim().min(1).max(60).optional()

/** Nominal dimensional lumber, by its actual depth (`LUMBER_DEPTH`). */
export const NominalLumber = z.enum(['2x4', '2x6', '2x8', '2x10', '2x12'])
export type NominalLumber = z.infer<typeof NominalLumber>

export const RoofingKind = z.enum([
  'asphalt-3-tab',
  'architectural-shingle',
  'standing-seam-metal',
  'concrete-tile',
  'clay-tile',
  'wood-shake',
  'slate',
])
export type RoofingKind = z.infer<typeof RoofingKind>

export const UnderlaymentKind = z.enum(['felt-15', 'felt-30', 'synthetic', 'ice-and-water'])
export type UnderlaymentKind = z.infer<typeof UnderlaymentKind>

/** Structural panels: roof sheathing and attic decking. */
export const PanelKind = z.enum(['osb', 'plywood'])
export type PanelKind = z.infer<typeof PanelKind>

/** Batt and blown fill the framing cavity; rigid board runs continuous over the framing. */
export const InsulationKind = z.enum(['batt', 'blown', 'rigid'])
export type InsulationKind = z.infer<typeof InsulationKind>

export const InteriorFinishKind = z.enum(['drywall', 'plaster', 'wood-plank'])
export type InteriorFinishKind = z.infer<typeof InteriorFinishKind>

export const RoofingLayer = z.object({ kind: RoofingKind, thickness: Thickness, name: LayerName })
export const UnderlaymentLayer = z.object({
  kind: UnderlaymentKind,
  thickness: Thickness,
  name: LayerName,
})
export const PanelLayer = z.object({ kind: PanelKind, thickness: Thickness, name: LayerName })
export const InsulationLayer = z.object({
  kind: InsulationKind,
  thickness: Thickness,
  name: LayerName,
})
export const InteriorFinishLayer = z.object({
  kind: InteriorFinishKind,
  thickness: Thickness,
  name: LayerName,
})

/** For trusses, `size` is the top chord: the depth the roof plane's deck carries. */
export const RoofStructure = z.object({
  system: z.enum(['rafters', 'trusses']),
  size: NominalLumber,
  spacing: z.number().finite().positive(),
})
export type RoofStructure = z.infer<typeof RoofStructure>

/** `truss-chords`: the ceiling hangs from the roof trusses' bottom chords, `size` deep. */
export const CeilingFraming = z.object({
  system: z.enum(['joists', 'truss-chords']),
  size: NominalLumber,
  spacing: z.number().finite().positive(),
})
export type CeilingFraming = z.infer<typeof CeilingFraming>

/**
 * A roof plane, outside in. Absent optional layers are none. The plane's
 * `deckThickness` and `shingleThickness` derive from it (`roofBuildUpPatch`).
 */
export const RoofBuildUp = z.object({
  presetId: z.string().optional(),
  roofing: RoofingLayer,
  underlayment: UnderlaymentLayer.optional(),
  sheathing: PanelLayer,
  structure: RoofStructure,
  insulation: InsulationLayer.optional(),
  /** Under the structure, the room-facing face of a cathedral ceiling. */
  finish: InteriorFinishLayer.optional(),
})
export type RoofBuildUp = z.infer<typeof RoofBuildUp>

/**
 * A ceiling, bottom up from its stored height (the finished underside).
 * Absent layers are none.
 */
export const CeilingBuildUp = z.object({
  presetId: z.string().optional(),
  finish: InteriorFinishLayer.optional(),
  framing: CeilingFraming.optional(),
  /** Over the framing, for attic storage. */
  decking: PanelLayer.optional(),
  insulation: InsulationLayer.optional(),
})
export type CeilingBuildUp = z.infer<typeof CeilingBuildUp>
