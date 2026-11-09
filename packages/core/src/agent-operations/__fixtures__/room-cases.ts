import { createZone, cutFloorOpening, divideZone, setZoneIntent, structureChangeBatch } from '../../commands/structure'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import {
  type AnyNode,
  BuildingNode,
  ItemNode,
  LevelNode,
  type WallNode,
  type ZoneNode,
} from '../../schema'
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

const LIT = { artificialLight: true, mechanicalVentilation: true }

/** The kitchen with metadata already on its zone: what a plan import or an earlier edit left. */
function withKitchenMetadata(metadata: Record<string, unknown>): SceneGraph {
  const scene = kitchenScene()
  scene.nodes.zone_kitchen = { ...(scene.nodes.zone_kitchen as ZoneNode), metadata }
  return scene
}

export function paintedKitchenScene(): SceneGraph {
  const scene = kitchenScene({ divided: true })
  scene.nodes.zone_kitchen = {
    ...(scene.nodes.zone_kitchen as ZoneNode),
    wallMaterial: 'library:preset-white',
    wallOverrides: [{ wallId: 'wall_north', face: 'a', finish: 'library:local-tile' }],
  }
  scene.nodes.zone_pantry = {
    ...(scene.nodes.zone_pantry as ZoneNode),
    wallMaterial: 'library:pantry-blue',
    wallOverrides: [{ wallId: 'wall_south', face: 'a', finish: 'library:pantry-tile' }],
  }
  scene.nodes.wall_north = {
    ...(scene.nodes.wall_north as WallNode),
    faceRegions: [{ id: 'wainscot', face: 'a', v1: 0.9, finish: 'library:wood' }],
  }
  return scene
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
    name: 'declares a room lit and ventilated by artificial means, beside the rest of its metadata',
    tool: 'set_zone_intent',
    scene: () => withKitchenMetadata({ note: 'from the plan' }),
    input: {
      zoneId: 'zone_kitchen',
      patch: { daylight: { artificialLight: true, mechanicalVentilation: true } },
    },
    expect: {
      result: { changes: 1 },
      check: (_result, nodes) =>
        JSON.stringify((nodes.zone_kitchen as ZoneNode).metadata) ===
        JSON.stringify({ note: 'from the plan', daylight: LIT })
          ? []
          : [`metadata must hold the note and the declaration: ${JSON.stringify((nodes.zone_kitchen as ZoneNode).metadata)}`],
    },
  },
  {
    name: 'a null daylight clears the declaration and keeps the rest of the metadata',
    tool: 'set_zone_intent',
    scene: () => withKitchenMetadata({ note: 'from the plan', daylight: LIT }),
    input: { zoneId: 'zone_kitchen', patch: { daylight: null } },
    expect: {
      result: { changes: 1 },
      check: (_result, nodes) =>
        JSON.stringify((nodes.zone_kitchen as ZoneNode).metadata) ===
        JSON.stringify({ note: 'from the plan' })
          ? []
          : [`metadata must hold the note alone: ${JSON.stringify((nodes.zone_kitchen as ZoneNode).metadata)}`],
    },
  },
  // Single public writes: room commands deliberately are not batchable.
  ...([
    ['omitting wall intent retains chosen white', { name: 'Studio' }, 'library:preset-white'],
    ['a wall intent string replaces chosen white', { wallMaterial: 'library:blue' }, 'library:blue'],
    ['an empty wall intent string remains a string', { wallMaterial: '' }, ''],
    ['null clears room wall intent without clearing local paint', { wallMaterial: null }, undefined],
  ] as const).map(([name, patch, wallMaterial]): AgentToolCase => ({
    name,
    tool: 'set_zone_intent',
    scene: paintedKitchenScene,
    input: { zoneId: 'zone_kitchen', patch },
    expect: {
      result: { changes: 1 },
      after: {
        zone_kitchen: {
          wallOverrides: [{ wallId: 'wall_north', face: 'a', finish: 'library:local-tile' }],
        },
        zone_pantry: {
          wallMaterial: 'library:pantry-blue',
          wallOverrides: [{ wallId: 'wall_south', face: 'a', finish: 'library:pantry-tile' }],
        },
        wall_north: {
          faceRegions: [{ id: 'wainscot', face: 'a', v1: 0.9, finish: 'library:wood' }],
        },
      },
      check: (_result, nodes) =>
        (nodes.zone_kitchen as ZoneNode).wallMaterial === wallMaterial
          ? []
          : [`persisted wallMaterial must be ${String(wallMaterial)}`],
    },
  })),
  {
    name: 'adjacent rooms read independent wall defaults and local paint',
    tool: 'get_zones',
    scene: paintedKitchenScene,
    input: { levelId: 'level_rooms' },
    expect: {
      result: {},
      contains: {
        zones: [
          {
            id: 'zone_kitchen',
            wallMaterial: 'library:preset-white',
            wallOverrides: [{ wallId: 'wall_north', face: 'a', finish: 'library:local-tile' }],
          },
          {
            id: 'zone_pantry',
            wallMaterial: 'library:pantry-blue',
            wallOverrides: [{ wallId: 'wall_south', face: 'a', finish: 'library:pantry-tile' }],
          },
        ],
      },
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
    name: 'a turn in degrees: half a turn about its centre, then moved',
    tool: 'move_zone',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', rotate: { angle: '180°' }, translate: [10, 0] },
    expect: {
      result: { zoneId: 'zone_kitchen' },
      check: (_result, nodes) => {
        const wall = nodes.wall_south as WallNode
        const off = [...wall.start, ...wall.end].some(
          (value, i) => Math.abs(value - [18, 4, 10, 4][i]!) > 1e-9,
        )
        return off ? [`wall_south runs ${wall.start} → ${wall.end}, not 18,4 → 10,4`] : []
      },
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
    name: 'a slab thickness in feet, as the person said it',
    tool: 'set_room_floor_construction',
    scene: kitchenScene,
    input: { zoneId: 'zone_kitchen', patch: { thickness: '1 ft' } },
    expect: { result: {}, after: { [plateId]: { thickness: 0.3048 } } },
  },
  {
    name: 'sets a footprint reference datum',
    tool: 'rebase_floor_reference',
    scene: kitchenScene,
    input: { slabId: plateId, referenceFloorElevation: 0.2 },
    expect: { result: {}, after: { [plateId]: { referenceFloorElevation: 0.2 } } },
  },
  {
    name: 'a reference datum in inches',
    tool: 'rebase_floor_reference',
    scene: kitchenScene,
    input: { slabId: plateId, referenceFloorElevation: '8 in' },
    expect: { result: {}, after: { [plateId]: { referenceFloorElevation: 0.2032 } } },
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

function outdoorRoomsScene(patch?: Parameters<typeof setZoneIntent>[1]['patch']): SceneGraph {
  const scene = kitchenScene()
  let nodes = scene.nodes as Record<string, AnyNode>
  let sequence = 0
  const mintId = (kind: string) => kind === 'zone' ? 'zone_outdoor' : `${kind}_outdoor${++sequence}`
  const porch = createZone(nodes, {
    levelId: 'level_rooms', name: 'Porch', polygon: [[2, 4], [6, 4], [6, 6], [2, 6]],
    enclose: false, intent: { roomType: 'porch' }, mintId,
  })
  nodes = applySceneChanges(nodes, structureChangeBatch(porch.changes))
  nodes = { ...reconcileSceneStructure({ nodes, mintId }).nodes } as Record<string, AnyNode>
  if (patch) {
    const before = nodes
    nodes = applySceneChanges(nodes, structureChangeBatch(setZoneIntent(nodes, { zoneId: 'zone_outdoor', patch }).changes))
    nodes = { ...reconcileSceneStructure({ nodes, previousNodes: before, mintId }).nodes } as Record<string, AnyNode>
  }
  return { ...scene, nodes }
}

export const OUTDOOR_ROOM_READ_CASES: AgentToolCase[] = [
  {
    name: 'an ordinary room has roomType room, no step-down and no porch framing',
    tool: 'get_zones', scene: kitchenScene, input: { levelId: 'level_rooms' },
    expect: { result: {}, contains: { zones: [{ id: 'zone_kitchen', roomType: 'room', floor: { drop: 0 }, porchFraming: null }] } },
  },
  {
    name: 'a covered porch reports its default step-down, automatic framing and existing generated counts',
    tool: 'get_zones', scene: () => outdoorRoomsScene(), input: { levelId: 'level_rooms' },
    expect: { result: {}, contains: { zones: [{ id: 'zone_outdoor', roomType: 'porch', floor: { drop: 1.5 * 0.0254 }, porchFraming: { auto: true, postSize: '6x6', postSpacing: 8 * 0.3048, beamSize: '6x8', postCount: 3, beamCount: 3 } }] } },
  },
  {
    name: 'hand-edited porch framing reports auto false and counts only its own remaining generated parts',
    tool: 'get_zones', scene: () => {
      const scene = outdoorRoomsScene({ floor: { drop: 0.05 }, porchFraming: { auto: false, postSize: '4x4', postSpacing: 1.5, beamSize: '6x10' } })
      const part = Object.values(scene.nodes as Record<string, AnyNode>).find((node) => node.type === 'column' && node.metadata?.porchOf === 'zone_outdoor')!
      delete scene.nodes[part.id]
      ;(scene.nodes.level_rooms as LevelNode).children = (scene.nodes.level_rooms as LevelNode).children.filter((id) => id !== part.id)
      return scene
    }, input: { levelId: 'level_rooms' },
    expect: { result: {}, contains: { zones: [{ id: 'zone_outdoor', roomType: 'porch', floor: { drop: 0.05 }, porchFraming: { auto: false, postSize: '4x4', postSpacing: 1.5, beamSize: '6x10', postCount: 2, beamCount: 3 } }, { id: 'zone_kitchen', porchFraming: null }] } },
  },
  {
    name: 'a deck reports its step-down, default boards and no automatic porch roof framing',
    tool: 'get_zones', scene: () => outdoorRoomsScene({ roomType: 'deck' }), input: { levelId: 'level_rooms' },
    expect: { result: {}, contains: { zones: [{ id: 'zone_outdoor', roomType: 'deck', floor: { drop: 0.0254 }, porchFraming: { auto: false, postSize: '6x6', postSpacing: 8 * 0.3048, beamSize: '6x8', postCount: 0, beamCount: 0 }, decking: { boardSize: '5/4x6', gap: 0.0254 / 4, direction: 'parallel' } }] } },
  },
  {
    name: 'a patio reports step-down and no automatic porch framing',
    tool: 'get_zones', scene: () => outdoorRoomsScene({ roomType: 'patio' }), input: { levelId: 'level_rooms' },
    expect: { result: {}, contains: { zones: [{ id: 'zone_outdoor', roomType: 'patio', floor: { drop: 1.5 * 0.0254 }, porchFraming: { auto: false, postSize: '6x6', postSpacing: 8 * 0.3048, beamSize: '6x8', postCount: 0, beamCount: 0 } }] } },
  },
  {
    name: 'custom deck boards and explicitly enabled roof framing use the set_zone_intent names and units',
    tool: 'get_zones', scene: () => outdoorRoomsScene({ roomType: 'deck', floor: { drop: 0.02 }, porchFraming: { auto: true, postSize: '8x8' }, decking: { boardSize: 'composite', gap: 0.004, direction: 'diagonal' } }), input: { levelId: 'level_rooms' },
    expect: { result: {}, contains: { zones: [{ id: 'zone_outdoor', roomType: 'deck', floor: { drop: 0.02 }, porchFraming: { auto: true, postSize: '8x8', postSpacing: 8 * 0.3048, beamSize: '6x8', postCount: 3, beamCount: 3 }, decking: { boardSize: 'composite', gap: 0.004, direction: 'diagonal' } }] } },
  },
]
