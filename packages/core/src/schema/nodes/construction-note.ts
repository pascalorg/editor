import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ConstructionNoteTerminator = z.enum(['arrow', 'filled-arrow', 'slash', 'dot', 'none'])
export const ConstructionNoteLeaderStyle = z.enum(['straight', 'curved'])
export const ConstructionNoteContractScope = z.enum(['contract', 'owner', 'existing', 'nic'])
export const ConstructionNoteSpecialtyKind = z.enum([
  'access',
  'rated-assembly',
  'plumbing-fixture',
  'solid-fuel',
  'closet',
  'equipment',
  'overhead',
])

const ConstructionNoteAccessSpecialty = z.object({
  kind: z.literal('access'),
  spaceType: z.enum(['attic', 'crawl-space']).default('attic'),
  accessType: z.enum(['scuttle', 'panel', 'door']).default('scuttle'),
  openingWidth: z.number().positive().default(0.55),
  openingHeight: z.number().positive().default(0.75),
})

const ConstructionNoteRatedAssemblySpecialty = z.object({
  kind: z.literal('rated-assembly'),
  assemblyType: z
    .enum(['firewall', 'fire-barrier', 'smoke-barrier', 'rated-assembly'])
    .default('firewall'),
  ratingMinutes: z.number().int().min(15).max(240).default(60),
  assemblyReference: z.string().trim().max(120).default('LISTED ASSEMBLY'),
})

const ConstructionNotePlumbingFixtureSpecialty = z.object({
  kind: z.literal('plumbing-fixture'),
  fixtureType: z.enum(['tub', 'shower', 'spa']).default('shower'),
  width: z.number().positive().default(0.9),
  depth: z.number().positive().default(0.9),
  material: z.string().trim().max(80).default('ACRYLIC'),
})

const ConstructionNoteSolidFuelSpecialty = z.object({
  kind: z.literal('solid-fuel'),
  applianceType: z.enum(['fireplace', 'wood-stove', 'pellet-stove']).default('fireplace'),
  minimumClearance: z.number().nonnegative().default(0.45),
  requirement: z.string().trim().max(160).default('INSTALL PER LISTING'),
})

const ConstructionNoteClosetSpecialty = z.object({
  kind: z.literal('closet'),
  closetType: z.enum(['reach-in', 'walk-in', 'linen']).default('reach-in'),
  shelfCount: z.number().int().min(0).max(20).default(1),
  shelfDepth: z.number().positive().default(0.35),
  hasPole: z.boolean().default(true),
})

const ConstructionNoteEquipmentSpecialty = z.object({
  kind: z.literal('equipment'),
  identifier: z.string().trim().min(1).max(40).default('EQ-1'),
  equipmentType: z.string().trim().min(1).max(100).default('EQUIPMENT'),
})

const ConstructionNoteOverheadSpecialty = z.object({
  kind: z.literal('overhead'),
  outlineType: z.enum(['floor', 'balcony', 'projection']).default('floor'),
  width: z.number().positive().default(3),
  depth: z.number().positive().default(1.5),
  rotation: z.number().default(0),
})

export const ConstructionNoteSpecialty = z.discriminatedUnion('kind', [
  ConstructionNoteAccessSpecialty,
  ConstructionNoteRatedAssemblySpecialty,
  ConstructionNotePlumbingFixtureSpecialty,
  ConstructionNoteSolidFuelSpecialty,
  ConstructionNoteClosetSpecialty,
  ConstructionNoteEquipmentSpecialty,
  ConstructionNoteOverheadSpecialty,
])

export const ConstructionNoteNode = BaseNode.extend({
  id: objectId('construction-note'),
  type: nodeType('construction-note'),
  anchor: z.tuple([z.number(), z.number()]).default([0, 0]),
  textPosition: z.tuple([z.number(), z.number()]).default([1.5, 0.75]),
  text: z.string().trim().min(1).default('CONSTRUCTION NOTE'),
  terminator: ConstructionNoteTerminator.default('arrow'),
  leaderStyle: ConstructionNoteLeaderStyle.default('straight'),
  curveControl: z.tuple([z.number().min(0.1).max(0.9), z.number()]).default([0.5, 0.35]),
  shoulderLength: z.number().min(0.15).max(3).default(0.55),
  targetId: z.string().nullable().default(null),
  targetOffset: z.tuple([z.number(), z.number()]).default([0, 0]),
  specialty: ConstructionNoteSpecialty.nullable().default(null),
  contractScope: ConstructionNoteContractScope.default('contract'),
  scopeReference: z.string().trim().max(120).default(''),
}).describe(
  dedent`
  Construction note node - a floor-plan annotation with an associative straight or curved leader
  - anchor: absolute fallback/free target in level-local plan coordinates
  - textPosition: plan position of the multiline note block
  - targetId/targetOffset: optional attachment that follows a referenced scene node
  - terminator: open arrow, filled arrow, slash, dot, or no leader terminator
  - leaderStyle: straight or quadratic curved leader
  - curveControl: chord fraction and perpendicular offset for the on-curve leader handle
  - specialty: optional typed access, rated-assembly, fixture, solid-fuel, closet, equipment, or overhead payload
  - contractScope/scopeReference: contract responsibility metadata, including explicit NIC presentation
  `,
)

export type ConstructionNoteContractScope = z.infer<typeof ConstructionNoteContractScope>
export type ConstructionNoteLeaderStyle = z.infer<typeof ConstructionNoteLeaderStyle>
export type ConstructionNoteSpecialty = z.infer<typeof ConstructionNoteSpecialty>
export type ConstructionNoteSpecialtyKind = z.infer<typeof ConstructionNoteSpecialtyKind>
export type ConstructionNoteTerminator = z.infer<typeof ConstructionNoteTerminator>
export type ConstructionNoteNode = z.infer<typeof ConstructionNoteNode>
