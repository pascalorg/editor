import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const INCH = 0.0254
const PlanPoint = z.tuple([z.number(), z.number()])

/**
 * What a beam is made of: sawn lumber (a solid timber or 2x plies nailed up), the same
 * pressure-treated for ground contact and the weather, LVL, glulam, or a steel W shape.
 */
export const BeamMaterial = z.enum(['sawn', 'pressure-treated', 'lvl', 'glulam', 'steel'])
export type BeamMaterial = z.infer<typeof BeamMaterial>

/**
 * How the joists it carries meet the beam (under the joists, or among them): a
 * dropped beam is under them, its top the plane they bear on; a flush beam is among them, the
 * joists hung from its sides.
 */
export const BeamPlacement = z.enum(['dropped', 'flush'])
export type BeamPlacement = z.infer<typeof BeamPlacement>

/** One stock beam: a nominal size, how many plies of it, its actual section and what it is. */
export type BeamSizePreset = {
  id: string
  /** The size as a framing plan prints it: "6x8", "(2) 2x10", "1-3/4x11-7/8 LVL". */
  label: string
  /** Nominal size of one ply. */
  size: string
  plies: number
  /** Actual width of the whole member (every ply), metres. */
  width: number
  /** Actual depth, metres. */
  depth: number
  material: BeamMaterial
}

/** A sawn stock size: one timber, or `plies` of a 2x nailed up (`width` is one ply's, inches). */
function sawn<const Id extends string>(
  id: Id,
  size: string,
  width: number,
  depth: number,
  plies = 1,
) {
  return {
    id,
    label: plies > 1 ? `(${plies}) ${size}` : size,
    size,
    plies,
    width: width * plies * INCH,
    depth: depth * INCH,
    material: 'sawn' as const,
  }
}

/**
 * The stock sizes a beam is picked from, at their actual dressed sizes: a sawn 4x is 3-1/2 in
 * wide and a 6x 5-1/2 in; a 2x ply 1-1/2 in; LVL 1-3/4 in a ply; glulam 5-1/8 in; a W8x10 is
 * 3.94 in across its flanges and 7.89 in deep.
 */
export const BEAM_SIZE_PRESETS = [
  sawn('4x6', '4x6', 3.5, 5.5),
  sawn('4x8', '4x8', 3.5, 7.25),
  sawn('4x10', '4x10', 3.5, 9.25),
  sawn('4x12', '4x12', 3.5, 11.25),
  sawn('6x6', '6x6', 5.5, 5.5),
  sawn('6x8', '6x8', 5.5, 7.5),
  sawn('6x10', '6x10', 5.5, 9.5),
  sawn('6x12', '6x12', 5.5, 11.5),
  sawn('(2)2x8', '2x8', 1.5, 7.25, 2),
  sawn('(2)2x10', '2x10', 1.5, 9.25, 2),
  sawn('(2)2x12', '2x12', 1.5, 11.25, 2),
  sawn('(3)2x10', '2x10', 1.5, 9.25, 3),
  sawn('(3)2x12', '2x12', 1.5, 11.25, 3),
  {
    id: 'lvl-1-3/4x9-1/4',
    label: '1-3/4x9-1/4 LVL',
    size: '1-3/4x9-1/4',
    plies: 1,
    width: 1.75 * INCH,
    depth: 9.25 * INCH,
    material: 'lvl',
  },
  {
    id: 'lvl-1-3/4x11-7/8',
    label: '1-3/4x11-7/8 LVL',
    size: '1-3/4x11-7/8',
    plies: 1,
    width: 1.75 * INCH,
    depth: 11.875 * INCH,
    material: 'lvl',
  },
  {
    id: '(2)lvl-1-3/4x11-7/8',
    label: '(2) 1-3/4x11-7/8 LVL',
    size: '1-3/4x11-7/8',
    plies: 2,
    width: 3.5 * INCH,
    depth: 11.875 * INCH,
    material: 'lvl',
  },
  {
    id: 'glulam-5-1/8x9',
    label: '5-1/8x9 GLB',
    size: '5-1/8x9',
    plies: 1,
    width: 5.125 * INCH,
    depth: 9 * INCH,
    material: 'glulam',
  },
  {
    id: 'glulam-5-1/8x12',
    label: '5-1/8x12 GLB',
    size: '5-1/8x12',
    plies: 1,
    width: 5.125 * INCH,
    depth: 12 * INCH,
    material: 'glulam',
  },
  {
    id: 'W8x10',
    label: 'W8x10',
    size: 'W8x10',
    plies: 1,
    width: 3.94 * INCH,
    depth: 7.89 * INCH,
    material: 'steel',
  },
] as const satisfies readonly BeamSizePreset[]

export type BeamSizePresetId = (typeof BEAM_SIZE_PRESETS)[number]['id']

/** A new beam's size: a 6x8, the header a porch's posts carry. */
export const DEFAULT_BEAM_SIZE_PRESET_ID = '6x8' satisfies BeamSizePresetId

export const BeamNode = BaseNode.extend({
  id: objectId('beam'),
  type: nodeType('beam'),
  start: PlanPoint,
  end: PlanPoint,
  width: z
    .number()
    .positive()
    .default(5.5 * INCH),
  depth: z
    .number()
    .positive()
    .default(7.5 * INCH),
  size: z.string().optional(),
  plies: z.number().int().min(1).max(5).default(1),
  material: BeamMaterial.default('sawn'),
  placement: BeamPlacement.default('dropped'),
  topElevation: z.number().optional(),
  // A slab the beam belongs to (a porch's or a deck's): a reference for what builds and frames
  // around it, never its height.
  supportSlabId: z.string().optional(),
}).describe(
  dedent`
  Beam node - a horizontal framing member drawn by hand: a header over a porch's posts, a deck's
  beam, a girder under a floor, a beam across an open span
  - start/end: the beam's centreline, level-local plan points like a wall's
  - width/depth: the actual section, metres (every ply together across)
  - size: the nominal size of one ply as printed ("6x8", "2x10", "1-3/4x11-7/8"); absent = a
    custom section, labelled by its actual size
  - plies: how many plies of size are nailed up side by side
  - material: sawn, pressure-treated, lvl, glulam or steel
  - placement: dropped (the joists bear on its top) or flush (the joists hang from its sides)
  - topElevation: its top, level-local metres; absent = the level's ceiling plane over it (the
    top of the walls), a dropped beam hanging under it, a flush one in the ceiling framing
  - supportSlabId: the slab it belongs to, if any (a porch or a deck)
  `,
)

export type BeamNode = z.infer<typeof BeamNode>
