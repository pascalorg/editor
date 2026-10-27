import { type AnyNode, BuildingNode, LevelNode, UnitNode, ZoneNode } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

// A building of flats on two storeys: a living room and a kitchen downstairs, a bedroom upstairs.
// "Apartment A" holds the living room, "Apartment B" the bedroom; the kitchen is in no unit. A
// second building, a shop, holds its own unit, so a listing can tell the buildings apart.

const room = (id: string, parentId: string, name: string) =>
  ZoneNode.parse({
    id,
    parentId,
    name,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  })

function flatsScene(): SceneGraph {
  const living = room('zone_living', 'level_g', 'Living room')
  const kitchen = room('zone_kitchen', 'level_g', 'Kitchen')
  const bed = room('zone_bed', 'level_1', 'Bedroom')
  const ground = LevelNode.parse({
    id: 'level_g',
    parentId: 'building_flats',
    level: 0,
    children: [living.id, kitchen.id],
  })
  const upper = LevelNode.parse({
    id: 'level_1',
    parentId: 'building_flats',
    level: 1,
    children: [bed.id],
  })
  const a = UnitNode.parse({
    id: 'unit_a',
    parentId: 'building_flats',
    name: 'Apartment A',
    members: [living.id],
  })
  const b = UnitNode.parse({
    id: 'unit_b',
    parentId: 'building_flats',
    name: 'Apartment B',
    members: [bed.id],
  })
  const flats = BuildingNode.parse({
    id: 'building_flats',
    name: 'Flats',
    children: [ground.id, upper.id, a.id, b.id],
  })
  const shopRoom = room('zone_shop', 'level_shop', 'Shop floor')
  const shopLevel = LevelNode.parse({
    id: 'level_shop',
    parentId: 'building_shop',
    level: 0,
    children: [shopRoom.id],
  })
  const shopUnit = UnitNode.parse({
    id: 'unit_shop',
    parentId: 'building_shop',
    name: 'Shop 1',
    kind: 'commercial',
    members: [shopRoom.id],
  })
  const shop = BuildingNode.parse({
    id: 'building_shop',
    name: 'Shop',
    children: [shopLevel.id, shopUnit.id],
  })
  const nodes = [flats, ground, upper, living, kitchen, bed, a, b, shop, shopLevel, shopRoom, shopUnit]
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: [flats.id, shop.id],
  }
}

const viewed = { activeLevelId: 'level_g' }

const unitHolding = (nodes: Readonly<Record<string, AnyNode>>, zoneId: string) =>
  Object.values(nodes).find(
    (node) => node.type === 'unit' && (node.members as readonly string[]).includes(zoneId),
  )

export const CREATE_UNIT_CASES: AgentToolCase[] = [
  {
    name: 'a duplex over two storeys of the viewed building, under that building',
    tool: 'create_unit',
    scene: flatsScene,
    input: { name: 'Duplex', memberZoneIds: ['zone_kitchen', 'zone_bed'], move: true },
    context: viewed,
    expect: {
      result: {
        name: 'Duplex',
        kind: 'apartment',
        buildingId: 'building_flats',
        memberCount: 2,
        members: ['zone_kitchen', 'zone_bed'],
      },
      after: { unit_b: { members: [] } },
      check: (result, nodes) => {
        const unit = nodes[result.unitId as string]
        if (unit?.type !== 'unit') return ['no unit node was made']
        const building = nodes.building_flats
        return [
          ...(unit.parentId === 'building_flats' ? [] : ['the unit is not under its building']),
          ...(building?.type === 'building' && building.children.includes(unit.id)
            ? []
            : ['the building does not list the unit']),
        ]
      },
      mentions: ['Duplex', '2 rooms', '1 moved from another unit'],
    },
  },
  {
    name: 'kind and colour are kept; a unit may hold no room yet',
    tool: 'create_unit',
    scene: flatsScene,
    input: { buildingId: 'building_flats', name: 'Suite 301', kind: 'hotel-room', color: '#123456' },
    expect: {
      result: { name: 'Suite 301', kind: 'hotel-room', color: '#123456', memberCount: 0 },
      mentions: ['Made hotel-room'],
    },
  },
  {
    name: 'a zone already in another unit is refused, naming that unit',
    tool: 'create_unit',
    scene: flatsScene,
    input: { buildingId: 'building_flats', name: 'Apartment C', memberZoneIds: ['zone_living'] },
    expect: { refusal: 'zone_in_other_unit', mentions: ['unit_a', 'Apartment A', 'move: true'] },
  },
  {
    name: 'a zone of another building is refused',
    tool: 'create_unit',
    scene: flatsScene,
    input: { buildingId: 'building_flats', name: 'Apartment C', memberZoneIds: ['zone_shop'] },
    expect: { refusal: 'zone_outside_building', mentions: ['zone_shop', 'building_flats'] },
  },
  {
    name: 'a missing zone, or a node that is no zone, is refused',
    tool: 'create_unit',
    scene: flatsScene,
    input: { buildingId: 'building_flats', name: 'Apartment C', memberZoneIds: ['level_g'] },
    expect: { refusal: 'zone_not_found', mentions: ['level_g', 'not a zone'] },
  },
  {
    name: 'a missing building is refused',
    tool: 'create_unit',
    scene: flatsScene,
    input: { buildingId: 'building_missing', name: 'Apartment C' },
    expect: { refusal: 'building_not_found' },
  },
  {
    name: 'two buildings and no viewed floor: say which',
    tool: 'create_unit',
    scene: flatsScene,
    input: { name: 'Apartment C' },
    context: { activeLevelId: null },
    expect: { refusal: 'building_required', mentions: ['building_flats', 'building_shop'] },
  },
]

export const SET_UNIT_MEMBERS_CASES: AgentToolCase[] = [
  {
    name: 'replaces the rooms a unit holds, across storeys, listing a zone once',
    tool: 'set_unit_members',
    scene: flatsScene,
    input: { unitId: 'unit_a', memberZoneIds: ['zone_kitchen', 'zone_living', 'zone_kitchen'] },
    expect: {
      result: { unitId: 'unit_a', memberCount: 2, members: ['zone_kitchen', 'zone_living'] },
      after: { unit_a: { members: ['zone_kitchen', 'zone_living'] }, unit_b: { members: ['zone_bed'] } },
    },
  },
  {
    name: 'an empty list empties the unit and deletes no room',
    tool: 'set_unit_members',
    scene: flatsScene,
    input: { unitId: 'unit_a', memberZoneIds: [] },
    expect: {
      result: { unitId: 'unit_a', memberCount: 0 },
      present: ['zone_living'],
      after: { unit_a: { members: [] } },
    },
  },
  {
    name: 'a zone in another unit is refused, naming that unit, and moves with move: true',
    tool: 'set_unit_members',
    scene: flatsScene,
    input: { unitId: 'unit_b', memberZoneIds: ['zone_bed', 'zone_living'] },
    expect: { refusal: 'zone_in_other_unit', mentions: ['unit_a', 'Apartment A'] },
  },
  {
    name: 'move: true takes the zone from the unit that held it',
    tool: 'set_unit_members',
    scene: flatsScene,
    input: { unitId: 'unit_b', memberZoneIds: ['zone_bed', 'zone_living'], move: true },
    expect: {
      result: { unitId: 'unit_b', memberCount: 2 },
      after: { unit_a: { members: [] }, unit_b: { members: ['zone_bed', 'zone_living'] } },
      check: (_result, nodes) =>
        unitHolding(nodes, 'zone_living')?.id === 'unit_b' ? [] : ['the living room is not in B'],
      mentions: ['1 moved from another unit'],
    },
  },
  {
    name: 'a unit that does not exist, or a node that is no unit, is refused',
    tool: 'set_unit_members',
    scene: flatsScene,
    input: { unitId: 'zone_living', memberZoneIds: [] },
    expect: { refusal: 'unit_not_found', mentions: ['zone_living', 'not a unit'] },
  },
  {
    name: 'a zone of another building is refused',
    tool: 'set_unit_members',
    scene: flatsScene,
    input: { unitId: 'unit_a', memberZoneIds: ['zone_shop'] },
    expect: { refusal: 'zone_outside_building' },
  },
]

export const LIST_UNITS_CASES: AgentToolCase[] = [
  {
    name: 'every unit of the scene, with its report',
    tool: 'list_units',
    scene: flatsScene,
    input: {},
    readOnly: true,
    expect: {
      result: {},
      contains: {
        units: [
          {
            unitId: 'unit_a',
            name: 'Apartment A',
            kind: 'apartment',
            members: ['zone_living'],
            report: {
              memberCount: 1,
              levelSpan: { minOrdinal: 0, maxOrdinal: 0, count: 1 },
              grossAreaM2: 12,
              members: [
                { zoneId: 'zone_living', name: 'Living room', levelId: 'level_g', levelOrdinal: 0, areaM2: 12 },
              ],
            },
          },
          { unitId: 'unit_b', name: 'Apartment B' },
          { unitId: 'unit_shop', name: 'Shop 1', kind: 'commercial' },
        ],
      },
      check: (result) => ((result.units as unknown[]).length === 3 ? [] : ['expected 3 units']),
    },
  },
  {
    name: 'the units of one building',
    tool: 'list_units',
    scene: flatsScene,
    input: { buildingId: 'building_shop' },
    readOnly: true,
    expect: {
      result: { units: [{ unitId: 'unit_shop', name: 'Shop 1', kind: 'commercial' }] },
      lacks: { units: [{ unitId: 'unit_a' }] },
    },
  },
  {
    name: 'a building that does not exist is refused',
    tool: 'list_units',
    scene: flatsScene,
    input: { buildingId: 'building_missing' },
    readOnly: true,
    expect: { refusal: 'building_not_found' },
  },
]

export const UNIT_CASES: AgentToolCase[] = [
  ...CREATE_UNIT_CASES,
  ...SET_UNIT_MEMBERS_CASES,
  ...LIST_UNITS_CASES,
]
