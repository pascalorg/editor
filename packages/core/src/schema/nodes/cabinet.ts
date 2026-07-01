import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const CabinetCompartment = z.object({
  id: z.string(),
  type: z.enum(['shelf', 'drawer', 'door']),
  height: z.number().positive().max(1.4).optional(),
  doorType: z.enum(['single-left', 'single-right', 'double', 'glass']).optional(),
  drawerCount: z.number().int().min(1).max(6).optional(),
  shelfCount: z.number().int().min(0).max(8).optional(),
})

export const CabinetNode = BaseNode.extend({
  id: objectId('cabinet'),
  type: nodeType('cabinet'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  width: z.number().min(0.3).max(3).default(0.6),
  depth: z.number().min(0.3).max(1.2).default(0.58),
  carcassHeight: z.number().min(0.4).max(1.4).default(0.72),
  operationState: z.number().min(0).max(1).default(0),
  plinthHeight: z.number().min(0).max(0.3).default(0.1),
  toeKickDepth: z.number().min(0).max(0.2).default(0.075),
  boardThickness: z.number().min(0.01).max(0.08).default(0.018),
  countertopThickness: z.number().min(0).max(0.08).default(0.02),
  countertopOverhang: z.number().min(0).max(0.12).default(0.02),
  frontThickness: z.number().min(0.01).max(0.05).default(0.018),
  frontGap: z.number().min(0.001).max(0.02).default(0.003),
  doorStyle: z.enum(['single-left', 'single-right', 'double', 'glass']).default('double'),
  handleStyle: z.enum(['none', 'bar', 'cutout', 'hole']).default('bar'),
  withBottomPanel: z.boolean().default(true),
  showPlinth: z.boolean().default(true),
  withCountertop: z.boolean().default(true),
  stack: z.array(CabinetCompartment).optional(),
}).describe('Parametric base modular cabinet node')

export type CabinetNode = z.infer<typeof CabinetNode>
