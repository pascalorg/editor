import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { ColumnNode } from './column'
import { RoofNode } from './roof'

export const LeanToExtensionNode = BaseNode.extend({
  id: objectId('leanto'),
  type: nodeType('lean-to-extension'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  children: z.array(z.union([ColumnNode.shape.id, RoofNode.shape.id])).default([]),

  span: z.number().min(0.5).max(20).default(4),
  projection: z.number().min(0.5).max(10).default(2.5),
  highEdgeHeight: z.number().min(0.8).max(10).default(2.8),
  pitch: z.number().min(1).max(45).default(10),

  roofThickness: z.number().min(0.02).max(0.5).default(0.1),
  eaveOverhang: z.number().min(0).max(1.5).default(0.25),
  sideOverhang: z.number().min(0).max(1.5).default(0.15),
  beamWidth: z.number().min(0.05).max(0.6).default(0.16),
  beamHeight: z.number().min(0.05).max(0.8).default(0.24),
  ledgerDepth: z.number().min(0.03).max(0.5).default(0.1),
  ledgerHeight: z.number().min(0.05).max(0.8).default(0.18),
  rafterWidth: z.number().min(0.03).max(0.4).default(0.08),
  rafterHeight: z.number().min(0.03).max(0.5).default(0.14),
  postWidth: z.number().min(0.05).max(0.6).default(0.16),
  postDepth: z.number().min(0.05).max(0.6).default(0.16),
  postCount: z.number().int().min(2).max(20).default(3),
  postInset: z.number().min(0).max(3).default(0.2),

  flashingEnabled: z.boolean().default(true),
  flashingHeight: z.number().min(0.03).max(0.5).default(0.12),
  flashingDepth: z.number().min(0.01).max(0.2).default(0.04),
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
