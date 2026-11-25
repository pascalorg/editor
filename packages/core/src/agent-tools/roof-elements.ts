import { z } from 'zod'
import { ROOF_ELEMENT_KINDS } from '../schema/nodes/roof-element-kinds'
import { SKYLIGHT_TYPE_ORDER } from '../schema/nodes/skylight'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const positiveLength = (description: string) =>
  measurement('length', 'm', { description, positive: true }).optional()

const nonnegativeLength = (description: string) =>
  measurement('length', 'm', { description, min: 0 }).optional()

export const addRoofElementTool = {
  name: 'add_roof_element',
  title: 'Add roof element',
  description:
    "Place one native roof accessory and return its host and achieved position. Supports chimney, skylight, solar-panel, cupola, box-vent, ridge-vent, turbine-vent and eyebrow-vent, with optional sizing, style, yaw (degrees) and library:/scene: finish presets. point is [x, z] in metres in the roof level's building-local plan axes. A roof id selects the highest physical covering; a roof-segment id queries only that segment, without bypassing cuts or higher covering. Missing covering refuses roof_point_outside_segment; unresolved cuts or covering intersections refuse roof_surface_unmeasured with the cause and node ids, without guessing another seat. Ridge vents snap to a native ridge/break line (a shed's high eave), refuse roof_no_ridge_line where none exists, and recheck the achieved point. They store a zero height offset; their renderer derives the seat. The returned planPoint is the achieved snapped point, not necessarily the requested point. Chimneys accept width, depth, heightAboveRidge, bodyShape, cap, capShape, flueCount, flueShape, shoulderStyle, bandStyle, cricketStyle, panelStyle, cornerBevel, materialPreset (body) and topMaterialPreset (cap). Skylights accept skylightType (flat, walk-on, lantern, opening, sliding), width, height (slope length), curb, curbHeight, materialPreset (frame) and glassMaterialPreset. Cupolas, vents and solar panels accept width/depth/height/rotation/materialPreset as supported; rows and columns size a solar-panel grid and are ignored by other kinds. Invalid options, unknown materials or bad ownership refuse before any mutation.",
  input: {
    kind: z.enum(ROOF_ELEMENT_KINDS),
    id: NodeId.describe('Roof or roof-segment id.'),
    point: z.array(z.number().finite()).length(2).describe('Level-plan [x, z] in metres.'),
    rows: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Solar rows; default 2. Ignored by other kinds.'),
    columns: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Solar columns; default 3. Ignored by other kinds.'),
    name: z.string().min(1).optional().describe('Name; defaults to the native name for this kind.'),
    width: positiveLength(
      'Element width in metres (chimney, skylight, cupola, box-vent, ridge-vent, eyebrow-vent).',
    ),
    depth: positiveLength('Element depth in metres (chimney, cupola, box-vent, eyebrow-vent).'),
    height: positiveLength(
      'Length/rise in metres: skylight slope length, or height for cupola, box-vent, ridge-vent, turbine-vent, eyebrow-vent.',
    ),
    rotation: measurement('angle', 'deg', {
      description: 'Yaw around the local/vertical axis in degrees (or angle with unit).',
    }).optional(),
    materialPreset: z
      .string()
      .min(1)
      .optional()
      .describe('Primary/body/frame finish: library: or scene: material ref.'),
    topMaterialPreset: z
      .string()
      .min(1)
      .optional()
      .describe('Chimney cap finish: library: or scene: material ref.'),
    glassMaterialPreset: z
      .string()
      .min(1)
      .optional()
      .describe('Skylight glazing finish: library: or scene: material ref.'),
    skylightType: z
      .enum(SKYLIGHT_TYPE_ORDER)
      .optional()
      .describe('Skylight preset style: flat, walk-on, lantern, opening or sliding.'),
    curb: z.boolean().optional().describe('Skylight raised curb toggle.'),
    curbHeight: nonnegativeLength('Skylight curb height in metres.'),
    heightAboveRidge: positiveLength('Chimney height above roof entry in metres (default 1.0).'),
    bodyShape: z
      .enum(['square', 'round'])
      .optional()
      .describe('Chimney body shape (default square).'),
    cap: z.boolean().optional().describe('Chimney cap toggle (default true).'),
    capShape: z
      .enum(['none', 'sloped', 'flat', 'stepped'])
      .optional()
      .describe('Chimney cap profile (default sloped).'),
    flueCount: z.number().int().min(0).max(4).optional().describe('Chimney flue count (0 to 4).'),
    flueShape: z
      .enum(['round', 'square'])
      .optional()
      .describe('Chimney flue cross-section (default round).'),
    shoulderStyle: z
      .enum(['none', 'tapered', 'corbeled'])
      .optional()
      .describe('Chimney shoulder stepping (default none).'),
    bandStyle: z
      .enum(['none', 'single', 'double'])
      .optional()
      .describe('Chimney belt course (default none).'),
    cricketStyle: z
      .enum(['none', 'simple'])
      .optional()
      .describe('Chimney upslope saddle cricket (default none).'),
    panelStyle: z
      .enum(['none', 'rectangular'])
      .optional()
      .describe('Chimney recessed wall panel (default none).'),
    cornerBevel: nonnegativeLength(
      'Chamfer radius in metres for chimney or box-vent corners (default 0).',
    ),
  },
}

export const addRoofElementOutput = {
  ok: z.literal(true),
  id: z.string(),
  kind: z.enum(ROOF_ELEMENT_KINDS),
  roofId: z.string(),
  segmentId: z.string(),
  localPosition: z.array(z.number()).length(3),
  rotation: z.number(),
  planPoint: z.array(z.number()).length(2),
  message: z.string(),
}
