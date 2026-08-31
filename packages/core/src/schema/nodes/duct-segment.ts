import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Round duct segment — a polyline of 3D points connected by cylindrical
 * duct sections. Forced-air HVAC supply/return runs in US residential.
 *
 * Phase 1 of the HVAC node system: just the geometry primitive. Fittings,
 * terminals, equipment, and typed ports come in later slices.
 *
 * Path coordinates are level-local meters: [x, y, z] tuples. y is height
 * above the level floor. A duct hung at ceiling height through three points
 * is e.g. `[[0, 2.6, 0], [3, 2.6, 0], [3, 2.6, 4]]`.
 *
 * Diameters are nominal US round-duct sizes in inches; the geometry
 * builder converts to meters for the cylinder radius.
 */
export const DuctSegmentNode = BaseNode.extend({
  id: objectId('duct-segment'),
  type: nodeType('duct-segment'),
  // Polyline path in level-local meters. Minimum two points (start, end).
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Cross-section. Round is the branch default; rect is the trunk /
  // plenum profile (real US systems: rect trunk, round branches); oval
  // is the flat-oval profile (two semicircles of the duct height joined
  // by flat sides) used where round won't fit a joist bay.
  shape: z.enum(['round', 'rect', 'oval']).default('round'),
  // Nominal inner diameter in inches (round shape). Common residential
  // sizes 4"–14"; we accept any positive number so the inspector slider
  // stays ergonomic and larger commercial sizes load without a schema bump.
  diameter: z.number().min(2).max(48).default(6),
  // Rect / oval cross-section in inches: width is the horizontal face,
  // height the vertical. Typical residential trunks 12×8 – 24×10. For
  // oval, height is also the end-cap semicircle diameter (width ≥ height).
  width: z.number().min(4).max(60).default(14),
  height: z.number().min(3).max(40).default(8),
  // Cross-section roll (radians) about the run direction. 0 = width
  // horizontal / height vertical (the natural orientation the geometry
  // derives from direction). Non-zero only on a rect riser turned out of
  // the horizontal plane, so its profile stays continuous through the
  // elbow it left instead of snapping to the world-axis fallback.
  roll: z.number().default(0),
  // Construction material. Spiral is round rigid sheet metal with the
  // helical lock seam drawn on the body (round shape only — rect / oval
  // runs render it as plain sheet metal).
  ductMaterial: z.enum(['sheet-metal', 'spiral', 'flex', 'duct-board']).default('flex'),
  // Whether to draw the construction body detail (spiral lock seam /
  // flex wire corrugation) on round runs. Off renders a smooth body —
  // lighter on the eyes and the GPU in dense scenes.
  seamDetail: z.boolean().default(false),
  // Whether the run wears its external insulation wrap (drawn as a
  // translucent shell). Off by default — bare duct.
  insulated: z.boolean().default(false),
  // External insulation R-value (used when insulated). Common flex-duct
  // values are R-4.2, R-6, R-8.
  insulationR: z.number().min(0).max(12).default(0.5),
  // Which side of the air loop this segment belongs to. Drives visual tint
  // and (in later slices) System graph membership.
  system: z.enum(['supply', 'return']).default('supply'),
  slots: z.record(z.string(), z.string()).optional(),
}).describe(
  dedent`
  Duct segment - polyline of 3D points connected by duct sections.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - shape: round (branches) | rect (trunks / plenums) | oval (flat-oval, tight joist bays)
  - diameter: nominal inner diameter in inches for round (typ. 4-14 residential)
  - width / height: rect / oval cross-section in inches (typ. 12x8 - 24x10 trunks)
  - roll: cross-section roll in radians (0 = upright; set on risers to stay continuous through their elbow)
  - ductMaterial: sheet-metal | spiral (round rigid, helical seam) | flex | duct-board
  - seamDetail: draw the spiral seam / flex corrugation on round runs (default off)
  - insulated: whether the run wears its external insulation wrap (default off)
  - insulationR: external insulation R-value when insulated (4, 6, 8 typical)
  - system: supply | return (drives visual tint)
  `,
)
export type DuctSegmentNode = z.infer<typeof DuctSegmentNode>
export type DuctSegmentNodeId = DuctSegmentNode['id']
