import dedent from 'dedent'
import { z } from 'zod'
import { AssetUrl } from '../asset-url'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Per-layer display state, keyed by the DXF layer name.
 *
 * Only layers the user has changed are stored. An absent entry means "as the
 * drawing declared it" — a drawing with 200 layers would otherwise write 200
 * redundant entries into every save.
 */
export const CadUnderlayLayerState = z.object({
  visible: z.boolean(),
  color: z.string().optional(),
})
export type CadUnderlayLayerState = z.infer<typeof CadUnderlayLayerState>

/**
 * The correction the user applied to a drawing whose declared scale was wrong
 * or absent: they measured something of known size and said what it should
 * have been. Kept so the calibration can be reviewed and redone rather than
 * being a one-way computation.
 *
 * Both lengths are in metres *as the drawing read at the time*, which is what
 * makes the record replayable — the ratio is the whole correction.
 */
export const CadUnderlayCalibration = z.object({
  /** What the drawing measured before the correction. */
  measuredMeters: z.number().positive(),
  /** What it should have measured. */
  actualMeters: z.number().positive(),
  /** Scale in force before the correction, so it can be undone exactly. */
  previousScale: z.number().positive(),
  label: z.string().default(''),
})
export type CadUnderlayCalibration = z.infer<typeof CadUnderlayCalibration>

export const CadUnderlayNode = BaseNode.extend({
  id: objectId('cad-underlay'),
  type: nodeType('cad-underlay'),
  /**
   * The parsed geometry asset (`@pascal-app/cad-import`'s underlay buffer),
   * not the drawing itself. The segments are held out of the scene graph on
   * purpose: a real DXF flattens to hundreds of thousands of them, which
   * would be carried by every save, every undo step and every scene fetch.
   */
  url: AssetUrl,
  /** The original DXF/DWG, kept so the drawing can be re-imported or exported. */
  sourceUrl: AssetUrl.optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /**
   * Metres per drawing unit. Taken from the drawing's `$INSUNITS` at import,
   * or from `calibration` when the file was unitless. Living on the node
   * rather than baked into the asset is what makes recalibration a property
   * change instead of a rewrite of a multi-megabyte buffer.
   */
  scale: z.number().positive().default(1),
  opacity: z.number().min(0).max(100).default(60),
  layers: z.record(z.string(), CadUnderlayLayerState).default({}),
  /**
   * A locked underlay is reference only: it cannot be selected, moved or
   * edited, and its geometry never catches the pointer. It is unlocked only
   * while the calibration UI is open, which is the one time the user is meant
   * to move it.
   */
  locked: z.boolean().default(true),
  calibration: CadUnderlayCalibration.nullable().default(null),
}).describe(
  dedent`
  CAD underlay node - a locked reference drawing imported from DXF/DWG, drawn on the level plane to trace over
  - url: parsed geometry asset; the drawing's segments are NOT stored in the scene graph
  - sourceUrl: the original CAD file
  - position/rotation: placement of the drawing origin in level-local meters
  - scale: meters per drawing unit
  - opacity: 0-100
  - layers: per-DXF-layer visibility and colour overrides, keyed by layer name
  - locked: reference-only; blocks selection and pointer interaction
  - calibration: the two-point measurement that produced scale, when the drawing was unitless
  `,
)

export type CadUnderlayNode = z.infer<typeof CadUnderlayNode>
export type CadUnderlayNodeId = CadUnderlayNode['id']
