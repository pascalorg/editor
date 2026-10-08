import { createZone, cutFloorOpening, divideZone, structureChangeBatch } from '../../commands/structure'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import { type AnyNode, BuildingNode, ItemNode, LevelNode } from '../../schema'
import { applySceneChanges } from '../apply-changes'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * The room transforms and floor-construction tools (divide_zone … create_mezzanine) on an 8 × 4 m
 * kitchen with its own walls, built and reconciled by the editor's own commands so its ceiling and
 * floor plate are the derived ones. The divided kitchen has a 5 × 1 m pantry split off along its
 * south-east corner by two separators.
 */

type Build = { divided?: boolean; hatch?: boolean; lamp?: boolean }
type Nodes = Readonly<Record<string, AnyNode>>

function kitchenScene({ divided, hatch, lamp }: Build = {}): SceneGraph {
  const names: Record<string, string[]> = {
    wall: ['wall_south', 'wall_east', 'wall_north', 'wall_west'],
    zone: ['zone_kitchen', 'zone_pantry'],
    ceiling: ['ceiling_kitchen', 'ceiling_pantry'],
    separator: ['separator_a', 'separator_b'],
    'floor-opening': ['floor-opening_hatch'],
  }
  const mintId = (kind: string) => names[kind]?.shift() ?? `${kind}_fixture`
  const building = BuildingNode.parse({ id: 'building_rooms', children: ['level_rooms'] })
  const level = LevelNode.parse({ id: 'level_rooms', parentId: building.id, level: 0, height: 3 })
  let nodes: Record<string, AnyNode> = { [building.id]: building, [level.id]: level }
  const apply = (plan: { changes: Parameters<typeof structureChangeBatch>[0] }) => {
    nodes = applySceneChanges(nodes, structureChangeBatch(plan.changes))
    nodes = { ...reconcileSceneStructure({ nodes, mintId }).nodes } as Record<string, AnyNode>
  }
  apply(
    createZone(nodes, {
      levelId: level.id,
      name: 'Kitchen',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      enclose: true,
      mintId,
    }),
  )
  if (divided)
    apply(
      divideZone(nodes, {
        zoneId: 'zone_kitchen',
        path: [
          [3, 0],
          [3, 1],
          [8, 1],
        ],
        mintId,
      }),
    )
  if (hatch)
    apply(
      cutFloorOpening(nodes, {
        zoneId: 'zone_kitchen',
        rect: { x: 1, z: 2, width: 1, depth: 1 },
        mintId,
      }),
    )
  if (lamp) {
    const item = ItemNode.parse({
      id: 'item_lamp',
      parentId: 'ceiling_kitchen',
      position: [4, -0.1, 2],
      asset: {
        id: 'lamp',
        category: 'lighting',
        name: 'Lamp',
        thumbnail: '/items/lamp/thumbnail.webp',
        src: '/items/lamp/model.glb',
        dimensions: [1, 1, 1],
        attachTo: 'ceiling',
      },
    })
    nodes = applySceneChanges(nodes, { create: [{ node: item, parentId: 'ceiling_kitchen' }] })
  }
  return { nodes, rootNodeIds: [building.id] }
}

/** The kitchen's floor plate: the reconciler names it from its footprint. */
const plateId = Object.values(kitchenScene().nodes as Nodes).find(
  (node) => node.type === 'slab' && node.plateRole === 'base',
)!.id

/** The scene holds this many nodes of each type: rooms and separators the call minted. */
const holds =
  (expected: Record<string, number>) => (_result: Record<string, unknown>, nodes: Nodes) =>
    Object.entries(expected).flatMap(([type, count]) => {
      const found = Object.values(nodes).filter((node) => node.type === type).length
      return found === count ? [] : [`${count} ${type} expected, ${found} found`]
    })

export const ROOM_CASES: AgentToolCase[] = [
  {
    name: 'divides an open plan with a path; the seed side keeps its id',
    tool: 'divide_zone',
    scene: kitchenScene,
    input: {
      zoneId: 'zone_kitchen',
      path: [
        [3, 0],
        [3, 1],
        [8, 1],
      ],
    },
    expect: {
      result: { changes: 2 },
      after: {
        zone_kitchen: {
          polygon: [
            [0, 0],
            [3, 0],
            [3, 1],
            [8, 1],
            [8, 4],
            [0, 4],
          ],
        },
      },
      check: (result, nodes) => [
        ...holds({ zone: 2, separator: 2, ceiling: 2 })(result, nodes),
        ...((result.zoneIds as string[] | undefined)?.length === 2 &&
        (result.zoneIds as string[]).includes('zone_kitchen')
          ? []
          : ['zoneIds lists both rooms']),
        ...((result.separatorIds as string[] | undefined)?.length === 2
          ? []
          : ['separatorIds lists both separators']),
      ],
    },
  },
  {
    name: 'an island too small to be a room is a conflict, and nothing changes',
    tool: 'divide_zone',
    scene: kitchenScene,
    input: {
      zoneId: 'zone_kitchen',
      closed: true,
      path: [
        [3, 1],
        [3.2, 1],
        [3.2, 1.2],
        [3, 1.2],
      ],
    },
    expect: {
      result: { changes: 0, separatorIds: [] },
      contains: { conflicts: [{ code: 'small-island' }] },
      check: holds({ zone: 1, separator: 0 }),
    },
  },
  {
    name: 'a room that does not exist is refused',
    tool: 'divide_zone',
    scene: kitchenScene,
    input: {
      zoneId: 'zone_missing',
      path: [
        [3, 0],
        [3, 4],
      ],
    },
    expect: { refusal: 'structure_refused', mentions: ['zone_missing'] },
  },
  {
    name: 'merges two rooms by removing the separators between them',
    tool: 'merge_zones',
    scene: () => kitchenScene({ divided: true }),
    input: { zoneIds: ['zone_kitchen', 'zone_pantry'] },
    expect: {
      result: { changes: 2 },
      absent: ['separator_a', 'separator_b'],
      check: holds({ zone: 1, ceiling: 1 }),
    },
  },
  {
    name: 'deletes a room with the walls only it uses',
    tool: 'delete_zone',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', contents: 'keep' },
    expect: {
      result: { payload: { zoneId: 'zone_kitchen', mode: 'delete', contents: 'keep' } },
      absent: ['zone_kitchen', 'wall_south', 'wall_east', 'wall_north', 'wall_west'],
      check: holds({ zone: 0, ceiling: 0 }),
    },
  },
  {
    name: 'a room Divide made merges back into its neighbour',
    tool: 'delete_zone',
    scene: () => kitchenScene({ divided: true }),
    input: { zoneId: 'zone_pantry', contents: 'delete' },
    expect: {
      result: {
        payload: { zoneId: 'zone_pantry', mode: 'merge', mergedIntoZoneId: 'zone_kitchen' },
      },
      present: ['zone_kitchen', 'wall_south'],
      absent: ['zone_pantry', 'separator_a', 'separator_b'],
      check: holds({ zone: 1 }),
    },
  },
  {
    name: 'renames a room and sets its floor finish',
    tool: 'set_zone_intent',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', patch: { name: 'Studio', floor: { finish: 'wood' } } },
    expect: {
      result: { changes: 1 },
      after: { zone_kitchen: { name: 'Studio', floor: { finish: 'wood' } } },
    },
  },
  {
    name: 'a floor key no room has is a conflict that says what to choose',
    tool: 'set_zone_intent',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', patch: { floor: { footprint: 'missing-floor' } } },
    expect: {
      result: { changes: 0 },
      contains: { conflicts: [{ code: 'room-floor-footprint' }] },
      mentions: ['Choose an existing floor key'],
      after: { zone_kitchen: { name: 'Kitchen' } },
    },
  },
  {
    name: 'moves a room with its walls',
    tool: 'move_zone',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', translate: [10, 0] },
    expect: {
      result: { zoneId: 'zone_kitchen', idMap: { zone_kitchen: ['zone_kitchen'] } },
      after: { zone_kitchen: { seed: [14, 2] }, wall_south: { start: [10, 0], end: [18, 0] } },
      check: holds({ zone: 1, wall: 4 }),
    },
  },
  {
    name: 'duplicates a room, its ceiling lamp hung on the copy’s ceiling',
    tool: 'duplicate_zone',
    scene: () => kitchenScene({ lamp: true }),
    input: { zoneId: 'zone_kitchen', translate: [10, 0] },
    expect: {
      result: {},
      after: { zone_kitchen: { seed: [4, 2] }, item_lamp: { parentId: 'ceiling_kitchen' } },
      check: (result, nodes) => {
        const copy = nodes[(result.idMap as Record<string, string[]>).item_lamp?.[0] ?? '']
        const ceiling = copy?.parentId ? nodes[copy.parentId] : undefined
        return [
          ...holds({ zone: 2, wall: 8, ceiling: 2, item: 2 })(result, nodes),
          ...(ceiling?.type === 'ceiling' && ceiling.zoneId === result.zoneId
            ? []
            : ['the copied lamp hangs on the copy’s ceiling']),
        ]
      },
    },
  },
  {
    name: 'turns a room a quarter about its centre, snapped to the grid',
    tool: 'rotate_zone',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', quarterTurns: 1 },
    expect: {
      result: { zoneId: 'zone_kitchen' },
      after: { wall_south: { start: [2, 6], end: [2, -2] } },
      check: holds({ zone: 1, wall: 4 }),
    },
  },
  {
    name: 'puts the outside faces of a level on their reference lines',
    tool: 'lock_outside_faces',
    scene: kitchenScene,
    input: { levelId: 'level_rooms' },
    expect: {
      result: {},
      after: {
        wall_south: { justification: 'a' },
        wall_east: { justification: 'a' },
        wall_north: { justification: 'a' },
        wall_west: { justification: 'a' },
      },
    },
  },
  {
    name: 'a level and rooms together are refused',
    tool: 'lock_outside_faces',
    scene: kitchenScene,
    input: { levelId: 'level_rooms', zoneIds: ['zone_kitchen'] },
    expect: { refusal: 'target_required', mentions: ['levelId or zoneIds'] },
  },
  {
    name: 'cuts a floor opening in a room',
    tool: 'cut_floor_opening',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', rect: { x: 2, z: 2, width: 1, depth: 1 } },
    expect: {
      result: { hints: [] },
      check: (result, nodes) => [
        ...holds({ 'floor-opening': 1 })(result, nodes),
        ...(nodes[(result.openingIds as string[] | undefined)?.[0] ?? '']?.type === 'floor-opening'
          ? []
          : ['openingIds names the opening']),
      ],
    },
  },
  {
    name: 'removes a floor opening',
    tool: 'remove_floor_opening',
    scene: () => kitchenScene({ hatch: true }),
    input: { id: 'floor-opening_hatch' },
    expect: {
      result: { openingId: 'floor-opening_hatch' },
      absent: ['floor-opening_hatch'],
      check: holds({ 'floor-opening': 0 }),
    },
  },
  {
    name: 'raises a ground floor on a foundation',
    tool: 'set_floor_foundation',
    scene: kitchenScene,
    input: { slabId: plateId, patch: { foundationHeight: 0.5 } },
    expect: { result: {}, after: { [plateId]: { foundation: { type: 'solid' } } } },
  },
  {
    name: 'a plate that does not exist is refused',
    tool: 'set_floor_foundation',
    scene: kitchenScene,
    input: { slabId: 'slab_missing', patch: { foundationHeight: 0.5 } },
    expect: { refusal: 'structure_refused', mentions: ['slab_missing'] },
  },
  {
    name: 'thickens the slab a room stands on',
    tool: 'set_room_floor_construction',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', patch: { thickness: 0.3 } },
    expect: { result: {}, after: { [plateId]: { thickness: 0.3 } } },
  },
  {
    name: 'sets a footprint reference datum',
    tool: 'rebase_floor_reference',
    scene: kitchenScene,
    input: { slabId: plateId, referenceFloorElevation: 0.2 },
    expect: { result: {}, after: { [plateId]: { referenceFloorElevation: 0.2 } } },
  },
  {
    name: 'adds a mezzanine over part of a room',
    tool: 'create_mezzanine',
    scene: kitchenScene,
    input: {
      hostZoneId: 'zone_kitchen',
      polygon: [
        [0, 0],
        [3, 0],
        [3, 4],
        [0, 4],
      ],
    },
    expect: { result: {}, check: holds({ zone: 2 }) },
  },
]
