/**
 * The case table of G2's slice N1, one notation: every length, angle and roof pitch a shared tool
 * took as a bare number before it went through `measurement()` or `roofPitch()`. Each row is a
 * field, the bare number calls gave it (it keeps its meaning, in the unit the field states) and
 * text in other units, with the number the tool's operation receives. No field is renamed.
 * `agent-tools/notation.test.ts` reads each value through the tool's own contract, the one the
 * MCP, the chat and Pro register; the operation rows in the tables beside this one (`roof-cases`,
 * `room-cases`, `cases`) run a call written in other units on the core, MCP and chat runners.
 */

export type NotationCase = {
  tool: string
  /** The field as a path into the input: `patch.thickness`, `faces[].rows[].height`. */
  field: string
  /** Each value a model may send, with the number the operation receives. */
  readings: [sent: number | string, received: number][]
}

const SIX_TWELVE = 26.565051177078 // atan(6 / 12), in degrees
const QUARTER_TURN = Math.PI / 2

export const NOTATION_CASES: NotationCase[] = [
  // U2: a pitch in degrees or as rise over run.
  {
    tool: 'create_roof',
    field: 'pitch',
    readings: [
      [40, 40],
      ['26.6°', 26.6],
      ['22½°', 22.5],
      ['6:12', SIX_TWELVE],
      ['6/12', SIX_TWELVE],
      ['+6/12', SIX_TWELVE],
      ['6 in 12', SIX_TWELVE],
      ['12:12', 45],
    ],
  },
  // U1: the stair tools' sizes, in metres.
  {
    tool: 'measure_stair',
    field: 'available.width',
    readings: [
      [1.2, 1.2],
      ['4 ft', 1.2192],
    ],
  },
  {
    tool: 'measure_stair',
    field: 'available.length',
    readings: [
      [4, 4],
      ['13 ft', 3.9624],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'width',
    readings: [
      [1, 1],
      ['42 in', 1.0668],
      ['3 ft 6 in', 1.0668],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'landingDepth',
    readings: [
      [1.1, 1.1],
      ['4 ft', 1.2192],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'innerGap',
    readings: [
      [0, 0],
      ['2 in', 0.0508],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'walkingLineOffset',
    readings: [
      [0.45, 0.45],
      ['18 in', 0.4572],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'targets.maxRiserHeight',
    readings: [
      [0.18, 0.18],
      ['7.75 in', 0.19685],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'targets.minimumGoing',
    readings: [
      [0.25, 0.25],
      ['10 in', 0.254],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'targets.targetGoing',
    readings: [
      [0.28, 0.28],
      ['11 in', 0.2794],
    ],
  },
  {
    tool: 'fit_stair',
    field: 'targets.minimumHeadroom',
    readings: [
      [2, 2],
      ['6 ft 8 in', 2.032],
    ],
  },
  // U1: the room and floor-construction tools' sizes, in metres; U3: their rotation, in radians.
  {
    tool: 'cut_floor_opening',
    field: 'rect.width',
    readings: [
      [1, 1],
      ['3 ft', 0.9144],
    ],
  },
  {
    tool: 'cut_floor_opening',
    field: 'rect.depth',
    readings: [
      [2, 2],
      ['80 in', 2.032],
    ],
  },
  {
    tool: 'set_floor_foundation',
    field: 'patch.thickness',
    readings: [
      [0.2, 0.2],
      ['8 in', 0.2032],
    ],
  },
  {
    tool: 'set_floor_foundation',
    field: 'patch.foundationHeight',
    readings: [
      [0.5, 0.5],
      ['18 in', 0.4572],
    ],
  },
  {
    tool: 'set_floor_foundation',
    field: 'patch.floorHeight',
    readings: [
      [0.6, 0.6],
      ['2 ft', 0.6096],
    ],
  },
  {
    tool: 'set_room_floor_construction',
    field: 'patch.thickness',
    readings: [
      [0.3, 0.3],
      ['1 ft', 0.3048],
    ],
  },
  {
    tool: 'rebase_floor_reference',
    field: 'referenceFloorElevation',
    readings: [
      [0.2, 0.2],
      ['8 in', 0.2032],
    ],
  },
  {
    tool: 'create_mezzanine',
    field: 'elevation',
    readings: [
      [1.5, 1.5],
      ['5 ft', 1.524],
    ],
  },
  {
    tool: 'create_mezzanine',
    field: 'thickness',
    readings: [
      [0.2, 0.2],
      ['8 in', 0.2032],
    ],
  },
  {
    tool: 'move_zone',
    field: 'rotate.angle',
    readings: [
      [QUARTER_TURN, QUARTER_TURN],
      ['90°', QUARTER_TURN],
    ],
  },
  {
    tool: 'duplicate_zone',
    field: 'rotate.angle',
    readings: [
      [Math.PI, Math.PI],
      ['180°', Math.PI],
    ],
  },
  {
    tool: 'rotate_zone',
    field: 'gridStep',
    readings: [
      [0.5, 0.5],
      ['1 ft', 0.3048],
    ],
  },
  {
    tool: 'set_zone_intent',
    field: 'patch.floor.thickness',
    readings: [
      [0.1, 0.1],
      ['4 in', 0.1016],
    ],
  },
  {
    tool: 'set_zone_intent',
    field: 'patch.floor.elevation',
    readings: [
      [-0.15, -0.15],
      ['-6 in', -0.1524],
    ],
  },
  // Lengths and angles the catalogue's U1 did not list, found by the inventory below.
  {
    tool: 'place_in_room',
    field: 'rotationDeg',
    readings: [
      [90, 90],
      ['0.5 turn', 180],
    ],
  },
  {
    tool: 'place_in_room',
    field: 'offset',
    readings: [
      [-0.3, -0.3],
      ['-1 ft', -0.3048],
    ],
  },
  {
    tool: 'place_in_room',
    field: 'inset',
    readings: [
      [0.1, 0.1],
      ['4 in', 0.1016],
    ],
  },
  {
    tool: 'view_scene',
    field: 'elevation',
    readings: [
      [12, 12],
      ['35°', 35],
    ],
  },
  {
    tool: 'view_scene',
    field: 'eyeHeight',
    readings: [
      [1.7, 1.7],
      ['5 ft 7 in', 1.7018],
    ],
  },
  {
    tool: 'view_scene',
    field: 'fov',
    readings: [
      [45, 45],
      ['60°', 60],
    ],
  },
  {
    tool: 'view_scene',
    field: 'camera.fov',
    readings: [
      [50, 50],
      ['0.25 turn', 90],
    ],
  },
  {
    tool: 'straighten_facade_photo',
    field: 'faces[].rows[].height',
    readings: [
      [2.1, 2.1],
      ['7 ft', 2.1336],
    ],
  },
  {
    tool: 'straighten_facade_photo',
    field: 'faces[].points[].along',
    readings: [
      [3, 3],
      ['10 ft', 3.048],
    ],
  },
  {
    tool: 'straighten_facade_photo',
    field: 'faces[].points[].height',
    readings: [
      [2.4, 2.4],
      ['8 ft', 2.4384],
    ],
  },
  {
    tool: 'straighten_facade_photo',
    field: 'focal35mm',
    readings: [
      [26, 26],
      ['2.6 cm', 26],
    ],
  },
]

/**
 * Every other number a shared tool takes by name, none of them a length or an angle. Numbers in
 * an array are coordinates (points, outlines, vectors) and whole numbers are counts, indices or
 * pixels, so neither is listed; a length or an angle added as a bare number fails the test.
 */
export const NOT_LENGTHS = new Set([
  'author_scene.payload.levels[].lights[].intensity',
  // Coordinates, in level metres.
  'add_column.x',
  'add_column.y',
  'add_column.z',
  'create_stair.x',
  'create_stair.z',
  'place_items.items[].x',
  'place_items.items[].y',
  'place_items.items[].z',
  'cut_floor_opening.rect.x',
  'cut_floor_opening.rect.z',
  'place_in_room.clearanceAreas[].minX',
  'place_in_room.clearanceAreas[].maxX',
  'place_in_room.clearanceAreas[].minZ',
  'place_in_room.clearanceAreas[].maxZ',
  'pull_site_data.latitude',
  'pull_site_data.longitude',
  // Fractions along a wall or an edge.
  'add_door.t',
  'add_door.position',
  'add_window.t',
  'add_window.position',
  'create_room.doors[].t',
  'create_room.windows[].t',
  // Ratios, a material's own properties, a duration.
  'view_scene.camera.aspect',
  'paint.material.properties.roughness',
  'paint.material.properties.metalness',
  'paint.material.properties.opacity',
  'create_roof.glazing.glassOpacity',
  'create_roof.glazing.glassRoughness',
  'paint.material.texture.scale',
  'generate_studio_media.settings.durationSeconds',
  // Design parameter values inherit their recipe's units, not one fixed physical length unit.
  'place_design.parameters{}',
  'validate_design.parameters{}',
])
