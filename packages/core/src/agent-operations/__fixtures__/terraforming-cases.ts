import type { AgentToolCase, SceneGraph } from './cases'
import { agentHouse, GROUNDS, type Ground, slopedLot } from './sloped-lots'

/** The terraforming set on every surface: one answer and one refusal each, on the sloped lots. */

const lot = (ground: Ground | null, house = true) => (): SceneGraph => ({
  nodes: slopedLot({ ground, house }),
  rootNodeIds: ['site_lot'],
})
const codes = (result: Record<string, unknown>) =>
  (result.open as { code: string }[]).map((finding) => finding.code)

export const TERRAFORMING_CASES: AgentToolCase[] = [
  {
    name: 'terrain facts: a house 1 m over a falling lot is in the air, its doors over the ground',
    tool: 'read_terrain_facts',
    scene: lot(GROUNDS.fallToRear),
    input: { section: { from: [0, -20], to: [0, 20] } },
    expect: {
      result: { hasTerrain: true },
      check: (result) => {
        const open = codes(result)
        const section = result.section as { ground: unknown[]; floors: unknown[] }
        return [
          ...(open.includes('floor_in_air') ? [] : ['no floor_in_air']),
          ...(open.filter((code) => code === 'door_above_ground').length === 2
            ? []
            : ['not two doors above the ground']),
          ...(section.ground.length === 2 && section.floors.length === 1
            ? []
            : ['the section is not a plane under one floor']),
        ]
      },
    },
  },
  {
    name: 'terrain facts: a flat site answers against the datum, nothing open',
    tool: 'read_terrain_facts',
    scene: lot(GROUNDS.flat),
    input: {},
    expect: {
      result: { hasTerrain: false, open: [] },
      mentions: ['flat datum'],
    },
  },
  {
    name: 'terrain facts need a site',
    tool: 'read_terrain_facts',
    scene: () => ({ nodes: {}, rootNodeIds: [] }),
    input: {},
    expect: { refusal: 'no_site' },
  },
  {
    name: 'seat_house balances cut and fill and leaves nothing open',
    tool: 'seat_house',
    // A house the editor made: its floor rests on the ground, and the scene settles after the seat.
    scene: () => ({ nodes: agentHouse({ ground: GROUNDS.fallToRear }), rootNodeIds: ['site_lot'] }),
    input: {},
    expect: {
      result: { strategy: 'balance', levelId: 'level_ground', buildingId: 'building_house' },
      check: (result) => {
        const after = result.after as { open: unknown[] }
        const earth = (result.cutVolumeM3 as number) + (result.fillVolumeM3 as number)
        return [
          ...(after.open.length ? [`open after seating: ${JSON.stringify(after.open)}`] : []),
          ...(earth < 40 ? [] : [`${earth} m3 moved`]),
          ...(Math.abs((result.movedBuildingByM as number) + 1) < 0.12
            ? []
            : [`moved ${result.movedBuildingByM}`]),
        ]
      },
    },
  },
  {
    name: 'seat_house takes a strategy or a ground height, not both',
    tool: 'seat_house',
    scene: lot(GROUNDS.fallToRear),
    input: { strategy: 'fill', groundM: 1 },
    expect: { refusal: 'invalid_input' },
  },
  {
    name: 'set_terrain_plane tilts a lot through two points',
    tool: 'set_terrain_plane',
    scene: lot(GROUNDS.flat, false),
    input: {
      area: [
        [-15, -20],
        [15, -20],
        [15, 20],
        [-15, 20],
      ],
      through: [
        { at: [0, 20], heightM: 0 },
        { at: [0, -20], heightM: -2 },
      ],
    },
    expect: { result: { slopePercent: 5, fallDirection: [0, -1], minM: -2, maxM: 0 } },
  },
  {
    name: 'set_terrain_plane refuses three points in a line',
    tool: 'set_terrain_plane',
    scene: lot(GROUNDS.flat, false),
    input: {
      area: { center: [0, 0], radiusM: 5 },
      through: [
        { at: [0, 0], heightM: 0 },
        { at: [1, 1], heightM: 1 },
        { at: [2, 2], heightM: 3 },
      ],
    },
    expect: { refusal: 'invalid_input' },
  },
  {
    name: 'grade_along_line lowers a swale and answers its outline',
    tool: 'grade_along_line',
    scene: lot(GROUNDS.flat, false),
    input: {
      line: [
        [-10, 0],
        [10, 0],
      ],
      widthM: 1,
      offsetM: -0.3,
    },
    expect: {
      result: { lengthM: 20, startM: -0.3, endM: -0.3, steepestPercent: 0, deepestCutM: 0.3 },
      check: (result) =>
        (result.outline as unknown[]).length === 4 ? [] : ['the outline is not four corners'],
    },
  },
  {
    name: 'grade_along_line refuses a slope limit the ends cannot hold',
    tool: 'grade_along_line',
    scene: lot(GROUNDS.steep, false),
    input: {
      line: [
        [10, 20],
        [10, 5],
      ],
      maxSlopePercent: 12,
    },
    expect: { refusal: 'slope_limit_unreachable', mentions: ['25.0 m'] },
  },
  {
    name: 'add_steps_to_ground solves the flight from the sill and the ground',
    tool: 'add_steps_to_ground',
    scene: lot(GROUNDS.fallToRear),
    input: { doorId: 'door_front' },
    expect: {
      result: { doorId: 'door_front', stepCount: 5, sillM: 0.15 },
      check: (result) =>
        Math.abs((result.riseM as number) - ((result.sillM as number) - (result.groundAtFootM as number))) < 0.01
          ? []
          : ['the rise is not sill minus ground at the foot'],
    },
  },
  {
    name: 'add_terraces cuts a slope into terraces that touch, each second one a retaining break',
    tool: 'add_terraces',
    scene: lot(GROUNDS.steep, false),
    input: {
      line: [
        [0, -12],
        [0, 0],
      ],
      widthM: 8,
      count: 3,
    },
    expect: {
      result: { changedSamples: 380 },
      check: (result) => {
        const terraces = result.terraces as { levelM: number; heldAs: string }[]
        return [
          ...(terraces.map((terrace) => terrace.heldAs).join() === 'break,lattice,break'
            ? []
            : ['the terraces do not alternate break and lattice']),
          ...(terraces.map((terrace) => terrace.levelM).join() === '2,1.2,0.4'
            ? []
            : [`levels ${terraces.map((terrace) => terrace.levelM).join()}`]),
        ]
      },
    },
  },
  {
    name: 'add_terraces refuses terraces under 1.5 m deep',
    tool: 'add_terraces',
    scene: lot(GROUNDS.steep, false),
    input: {
      line: [
        [0, -12],
        [0, 0],
      ],
      widthM: 8,
      count: 12,
    },
    expect: { refusal: 'invalid_input', mentions: ['1.5 m'] },
  },
  {
    name: 'add_steps_to_ground refuses a door the ground stands over',
    tool: 'add_steps_to_ground',
    scene: lot(GROUNDS.riseToRear),
    input: { doorId: 'door_front' },
    expect: { refusal: 'door_below_ground' },
  },
]
