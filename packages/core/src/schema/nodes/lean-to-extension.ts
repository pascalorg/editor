import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { ColumnNode } from './column'
import { RoofNode } from './roof'

export const LeanToConnectionMode = z.enum(['auto', 'manual'])
export const LeanToRoofEdge = z.enum(['+X', '-X', '+Z', '-Z'])
export const LeanToResizeLock = z.enum([
  'preserve-high-edge',
  'preserve-low-edge',
  'preserve-pitch',
])
export const LeanToEndCondition = z.enum(['open', 'wall-abutment', 'joined'])
export const LeanToFramingStrategy = z.enum(['hidden', 'rafters', 'purlins', 'covering-specific'])
export const LeanToHighSideMode = z.enum(['wall-ledger', 'independent-high-beam'])
export const LeanToPostLayoutMode = z.enum(['count', 'target-spacing'])
export const LeanToFootingStyle = z.enum(['none', 'base-plate', 'concrete-pad'])
export const LeanToCoveringType = z.enum(['generic', 'shingle', 'metal-panel'])
const DEFAULT_LOW_EDGE_HEIGHT = 2.7 - 3 * Math.tan((5 * Math.PI) / 180)
const DEFAULT_LEAN_TO_POST_SPACING = 3
export type LeanToConnectionMode = z.infer<typeof LeanToConnectionMode>
export type LeanToRoofEdge = z.infer<typeof LeanToRoofEdge>

export const LeanToExtensionNode = BaseNode.extend({
  id: objectId('leanto'),
  type: nodeType('lean-to-extension'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  children: z.array(z.union([ColumnNode.shape.id, RoofNode.shape.id])).default([]),

  span: z.number().min(0.5).max(100).default(4),
  autoSpan: z.boolean().default(true),
  projection: z.number().min(0.5).max(10).default(2.5),
  spanArcCenterZ: z
    .number()
    .optional()
    .describe(
      'Local-Z of the host wall arc center in the lean-to local frame (the crown sits on the local Z axis, so center X = 0). Derived from the host wall arc; absent for straight walls.',
    ),
  spanArcRadius: z
    .number()
    .optional()
    .describe(
      "The host wall's true arc radius, in metres. Derived from the host wall arc; absent for straight walls.",
    ),
  highEdgeHeight: z.number().min(0.8).max(10).default(2.8),
  lowEdgeHeight: z.number().min(0.2).max(10).default(DEFAULT_LOW_EDGE_HEIGHT),
  pitch: z.number().min(1).max(45).default(10),
  resizeLock: LeanToResizeLock.default('preserve-high-edge'),
  leftEndCondition: LeanToEndCondition.default('open'),
  rightEndCondition: LeanToEndCondition.default('open'),
  autoMiterCorners: z.boolean().default(true),
  sideFlashing: z.boolean().default(true),
  flashingProjection: z.number().min(0.01).max(0.5).default(0.025),
  flashingHeight: z.number().min(0.03).max(0.5).default(0.14),
  slots: z.record(z.string(), z.string()).optional(),

  highSideMode: LeanToHighSideMode.default('wall-ledger'),
  ledgerVerticalOffset: z.number().min(-1).max(1).default(0),
  lowBeamInset: z.number().min(0).max(2).default(0),

  gutterEnabled: z.boolean().default(true),
  gutterProfile: z.enum(['k-style', 'half-round', 'box']).default('k-style'),
  gutterSize: z.number().min(0.04).max(0.3).default(0.13),
  downspoutEnabled: z.boolean().default(true),
  downspoutPosition: z.number().min(-1).max(1).default(1),

  connectionMode: LeanToConnectionMode.default('auto'),
  hostRoofId: RoofNode.shape.id.optional(),
  hostRoofSegmentId: z.string().optional(),
  hostRoofEdge: LeanToRoofEdge.optional(),
  hostRoofEdgeRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  connectionOffset: z.number().min(-1).max(1).default(0),
  connectionInset: z.number().min(0).max(10).default(0),
  matchHostRoofMaterial: z.boolean().default(true),
  matchHostRoofStructure: z.boolean().default(true),

  roofThickness: z.number().min(0.02).max(0.5).default(0.1),
  shingleThickness: z.number().min(0).max(0.5).default(0.025),
  highOverhang: z.number().min(0).max(1.5).default(0),
  lowOverhang: z.number().min(0).max(1.5).default(0.25),
  leftOverhang: z.number().min(0).max(1.5).default(0.15),
  rightOverhang: z.number().min(0).max(1.5).default(0.15),
  coveringType: LeanToCoveringType.default('generic'),
  beamWidth: z.number().min(0.05).max(0.6).default(0.16),
  beamHeight: z.number().min(0.05).max(0.8).default(0.24),
  ledgerDepth: z.number().min(0.03).max(0.5).default(0.1),
  ledgerHeight: z.number().min(0.05).max(0.8).default(0.18),
  rafterWidth: z.number().min(0.03).max(0.4).default(0.08),
  rafterHeight: z.number().min(0.03).max(0.5).default(0.14),
  rafterSpacing: z.number().min(0.2).max(3).default(1.2),
  rafterEndInset: z.number().min(0).max(3).default(0),
  framingStrategy: LeanToFramingStrategy.default('rafters'),
  purlinWidth: z.number().min(0.03).max(0.4).default(0.08),
  purlinHeight: z.number().min(0.03).max(0.5).default(0.1),
  purlinSpacing: z.number().min(0.2).max(3).default(0.8),
  postWidth: z.number().min(0.05).max(0.6).default(0.16),
  postDepth: z.number().min(0.05).max(0.6).default(0.16),
  postCount: z.number().int().min(2).max(20).default(3),
  postLayoutMode: LeanToPostLayoutMode.default('target-spacing'),
  postSpacing: z.number().min(0.3).max(10).default(DEFAULT_LEAN_TO_POST_SPACING),
  postInset: z.number().min(0).max(3).default(0),
  postBracing: z.enum(['none', 'knee']).default('none'),
  footingStyle: LeanToFootingStyle.default('none'),
}).describe(
  dedent`
  Wall-hosted lean-to roof extension.
  The high edge attaches to the host wall and the mono-pitch roof falls along
  local +Z to a beam supported by a managed row of column children. Its roof is a standard
  shed roof segment with standard gutter and downspout children. It is an open canopy, not a
  standalone enclosed shed roof.
  `,
)

export type LeanToExtensionNode = z.infer<typeof LeanToExtensionNode>
