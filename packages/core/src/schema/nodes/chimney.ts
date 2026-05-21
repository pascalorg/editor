import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ChimneyMaterialRole = z.enum(['body', 'top'])
export type ChimneyMaterialRole = z.infer<typeof ChimneyMaterialRole>

export const ChimneyNode = BaseNode.extend({
  id: objectId('chimney'),
  type: nodeType('chimney'),

  // Body material — body, bands, flues, cricket.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Top material — cap surface. Falls back to `material` if unset.
  topMaterial: MaterialSchema.optional(),
  topMaterialPreset: z.string().optional(),

  // Host segment + segment-local 2D position. The Y component is
  // ignored; placement is anchored to the segment's pitched surface
  // by the renderer.
  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  bodyShape: z.enum(['square', 'round']).default('square'),
  bodyHollowDepth: z.number().default(0.6),
  bodyHollowMargin: z.number().default(0.08),
  width: z.number().default(0.6),
  depth: z.number().default(0.6),
  heightAboveRidge: z.number().default(1.0),
  cutoutOffset: z.number().default(0),
  // Chamfered corners on the body / cap / bands. 0 = sharp 90° corners
  // (existing behaviour, kept as default so previously-saved chimneys
  // look identical). A small positive value (~0.01-0.02 m) breaks up
  // the silhouette and reads as a stone or chamfered-brick chimney.
  // Square bodies only — round bodies have no corners to bevel.
  cornerBevel: z.number().default(0),

  cap: z.boolean().default(true),
  capShape: z.enum(['none', 'sloped', 'flat', 'stepped']).default('sloped'),
  capOverhang: z.number().default(0.04),
  capThickness: z.number().default(0.08),

  flueCount: z.number().int().min(0).max(4).default(1),
  flueShape: z.enum(['round', 'square']).default('round'),
  flueHeight: z.number().default(0.3),
  flueDiameter: z.number().default(0.22),
  flueSpacing: z.number().default(1),
  flueWallThickness: z.number().default(0.02),

  shoulderStyle: z.enum(['none', 'tapered', 'corbeled']).default('none'),
  shoulderHeight: z.number().default(0.5),
  shoulderExtent: z.number().default(0.1),

  bandStyle: z.enum(['none', 'single', 'double']).default('none'),
  bandHeight: z.number().default(0.1),
  bandExtent: z.number().default(0.04),
  bandOffset: z.number().default(0.4),

  cricketStyle: z.enum(['none', 'simple']).default('none'),
  cricketLength: z.number().default(0.6),
  cricketHeight: z.number().default(0.4),
  cricketSide: z.enum(['front', 'back']).default('front'),

  panelStyle: z.enum(['none', 'rectangular']).default('none'),
  panelDepth: z.number().default(0.03),
  panelHeight: z.number().default(0.8),
  panelOffsetTop: z.number().default(0.15),
  panelMargin: z.number().default(0.1),
}).describe(
  dedent`
  Chimney — a vertical brick/stone stack hosted on a roof segment.

  Position is segment-local (x along segment width, z along segment
  depth). The Y component is ignored — placement anchors to the
  segment's pitched surface. Rotation is yaw around the world-vertical
  axis (chimneys stay vertical regardless of the slope).
  `,
)

export type ChimneyNode = z.infer<typeof ChimneyNode>
