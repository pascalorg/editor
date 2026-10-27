import { z } from 'zod'
import type { AgentToolContract } from './contract'
import { NodeId } from './node-id'

// The schema's UNIT_KINDS, spelled here: a contract imports zod and dependency-free files only
// (contracts-purity.test.ts), and the operation parses the node with the schema itself.
export const unitKind = z
  .enum(['apartment', 'hotel-room', 'commercial', 'common'])
  .describe(
    'What the unit is: apartment (a dwelling: a flat, a condo, one side of a duplex), hotel-room (a suite or guest room), commercial (a shop, an office, a lot let on its own), common (shared space grouped on purpose). Default apartment.',
  )

const WHAT_A_UNIT_IS =
  'A unit is one dwelling, suite or tenancy of a building that holds several (an apartment, a condo, a hotel room, a shop): a named group of rooms (zones) under the building. Its members may span levels (a duplex). A zone belongs to at most one unit; a zone in no unit is common area (a corridor, a lobby, the stairs). A single-family house has no units.'

const buildingId = NodeId.optional().describe(
  "The building. Default: the building of the floor the person is viewing, else the scene's only building.",
)

const memberZoneIds = (what: string) =>
  z
    .array(NodeId)
    .describe(
      `${what}, by zone ids from get_zones or create_room, on any level of the building. A zone already in another unit is refused (zone_in_other_unit, naming that unit) unless move is true.`,
    )

const move = z
  .boolean()
  .optional()
  .describe('true: a zone already in another unit leaves that unit for this one.')

export const createUnitTool = {
  name: 'create_unit',
  title: 'Create unit',
  description: `${WHAT_A_UNIT_IS} Create one in a building, named as a person would (Apartment 2B, Suite 301, Shop 1), with the rooms it holds; add or change them later with set_unit_members.`,
  input: {
    buildingId,
    name: z
      .string()
      .min(1)
      .max(120)
      .describe('The unit as a person names it: Apartment 2B, Suite 301, Shop 1.'),
    kind: unitKind.optional(),
    color: z
      .string()
      .optional()
      .describe('#rrggbb tint of the unit in the plan (default Pascal’s).'),
    memberZoneIds: memberZoneIds('The rooms the unit holds').optional(),
    move,
  },
} as const satisfies AgentToolContract

export const setUnitMembersTool = {
  name: 'set_unit_members',
  title: 'Set unit members',
  description: `${WHAT_A_UNIT_IS} Replace the rooms a unit holds with this list: a zone left out leaves the unit and becomes common area, an empty list empties it. Every zone must be on a level of the unit's building.`,
  input: {
    unitId: NodeId.describe('The unit, by an id from create_unit or list_units.'),
    memberZoneIds: memberZoneIds('The rooms the unit holds from now on'),
    move,
  },
} as const satisfies AgentToolContract

export const listUnitsTool = {
  name: 'list_units',
  title: 'List units',
  description: `${WHAT_A_UNIT_IS} List the units of a building, or of every building: id, name, kind, colour, member zone ids and a report (member count, the levels it spans, gross area, each member with its name, level and area).`,
  input: { buildingId },
  annotations: { readOnlyHint: true },
} as const satisfies AgentToolContract

export const UNIT_TOOL_CONTRACTS = [createUnitTool, setUnitMembersTool, listUnitsTool] as const
