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
  // plenum profile (real US systems: rect trunk, round branches).
  shape: z.enum(['round', 'rect']).default('round'),
  // Nominal inner diameter in inches (round shape). Common residential
  // sizes 4"–14"; we accept any positive number so the inspector slider
  // stays ergonomic and larger commercial sizes load without a schema bump.
  diameter: z.number().min(2).max(48).default(6),
  // Rect-shape cross-section in inches: width is the horizontal face,
  // height the vertical. Typical residential trunks 12×8 – 24×10.
  width: z.number().min(4).max(60).default(14),
  height: z.number().min(3).max(40).default(8),
  // Construction material.
  ductMaterial: z.enum(['sheet-metal', 'flex', 'duct-board']).default('flex'),
  // External insulation R-value. 0 = bare. Common flex-duct values are R-4.2,
  // R-6, R-8.
  insulationR: z.number().min(0).max(12).default(0.5),
  // Which side of the air loop this segment belongs to. Drives visual tint
  // and (in later slices) System graph membership.
  system: z.enum(['supply', 'return']).default('supply'),
}).describe(
  dedent`
  Duct segment - polyline of 3D points connected by duct sections.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - shape: round (branches) | rect (trunks / plenums)
  - diameter: nominal inner diameter in inches for round (typ. 4-14 residential)
  - width / height: rect cross-section in inches (typ. 12x8 - 24x10 trunks)
  - ductMaterial: sheet-metal | flex | duct-board
  - insulationR: external insulation R-value (0, 4, 6, 8 typical)
  - system: supply | return (drives visual tint)
  `,
)
export type DuctSegmentNode = z.infer<typeof DuctSegmentNode>
export type DuctSegmentNodeId = DuctSegmentNode['id']
