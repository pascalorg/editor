import { z } from 'zod'
import { RoofGlazing, RoofSystemType } from '../schema/nodes/roof-glazing-config'
import { RoofType } from '../schema/nodes/roof-type'
import { measurement } from './measurement'
import { NodeId } from './node-id'

export const createRoofInput = {
  levelId: NodeId,
  roofLevelId: NodeId.optional(),
  useDedicatedRoofLevel: z.boolean().default(true),
  roofLevelLabel: z.string().default('Roof'),
  // A level ordinal (story index), not a length — kept numeric.
  roofLevelElevation: z.number().optional(),
  roofLevelHeight: measurement('length', 'm', {
    positive: true,
    description: 'Roof level height.',
  }).optional(),
  center: z.tuple([z.number(), z.number(), z.number()]).optional(),
  width: measurement('length', 'm', { positive: true, description: 'Roof width.' }),
  depth: measurement('length', 'm', { positive: true, description: 'Roof depth.' }),
  roofType: RoofType.default('hip'),
  roofSystem: RoofSystemType.default('standard'),
  glazing: RoofGlazing.optional(),
  barrelRise: measurement('length', 'm', {
    positive: true,
    description: 'Barrel arch rise, up to half the span.',
  }).optional(),
  barrelSegments: z.number().int().min(4).max(32).optional(),
  pitch: measurement('angle', 'deg', { min: 0, max: 85, description: 'Roof pitch.' }).default(35),
  wallHeight: measurement('length', 'm', { min: 0, description: 'Knee-wall height.' }).default(
    0.35,
  ),
  wallThickness: measurement('length', 'm', {
    positive: true,
    description: 'Wall thickness.',
  }).default(0.16),
  overhang: measurement('length', 'm', { min: 0, description: 'Eave overhang.' }).default(0.45),
  materialPreset: z.string().optional(),
  name: z.string().optional(),
}

export const createRoofTool = {
  name: 'create_roof',
  title: 'Create roof',
  description:
    'Create a roof with one segment and, by default, a dedicated roof level. Glazed construction supports gable, straight shed and barrel. For barrel, depth is the span and barrelRise is the arch rise, at most half the span. Glazing controls frame, glass, grid and panels. Paint glazed surfaces using glazing-frame, glazing-glass or glazing-solid.',
  input: createRoofInput,
}
