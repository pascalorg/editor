import type { AnyNode, StairNode, StairSegmentNode } from '../../schema'
import { rotateXZ, stairFootprintAABB } from '../../systems/stair/stair-footprint'
import type { AgentToolCase } from './cases'
import { storeysScene } from './structure-cases'

/**
 * create_stair does everything the hosted Architect plugin's add_stair did, so add_stair retires
 * into it. Each case is a call add_stair served, beside the create_stair call that does it now, run
 * without a model through the core, MCP and chat runners:
 * - the calls the host's stored threads hold (their coordinates moved into this scene's hall);
 * - the calls the Architect's skills teach: an L or U turning either way, the risers of the lower
 *   flight, cable, post-and-rail or board railings in black, steel or wood, a flight to no level
 *   for porch or deck steps, a rise given;
 * - add_stair's own sizing (risers of at most 7-3/4 in on 10-1/2 in treads), given as steps and
 *   length, as the retired answer tells a model to.
 *
 * Each check holds what add_stair built but its sizing: the middle of the bottom riser at (x, z)
 * with the first flight running from it along the climb (the one origin both tools wrote, checked
 * against the stair's geometry), the flights and landings in order with each landing as deep as the
 * stair is wide, the railings, the levels joined and the opening cut. The risers and the run are
 * create_stair's own (risers of at most 18 cm on 28 cm goings, within add_stair's limits: 16 risers
 * for this 2.8 m storey, where add_stair built 15), except in the cases that pass add_stair's sizing
 * as steps and length, which build its risers and run. add_stair's compass climb is
 * create_stair's rotation (south 0, east 90, north 180, west 270), its shape a layout and a turn
 * ('L-left' is l, left), its lowerRisers create_stair's lowerSteps (add_stair rounded half down,
 * create_stair rounds it up: an odd count passes it), and its railing names library ids ('black'
 * library:preset-nearblack, 'steel' library:metal-steel, 'wood-plank' library:wood-woodplank19).
 */

type Built = {
  /** The flights and landings in order, `flight <risers>` or `landing`, then the side it turns to. */
  chain: string[]
  railing?: { mode: string; style?: string; material?: string }
  /** The level it arrives on; null for a flight to no level. */
  toLevelId: string | null
  rise?: number
  /** The flights' run, landings aside, when the call fixes it. */
  run?: number
  name?: string
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3

/** Where the call put the stair: (x, z) and the climb in degrees. */
type Placed = { x: number; z: number; rotation: number }

function asAddStairBuilt(expected: Built, placed: Placed) {
  return (result: Record<string, unknown>, nodes: Readonly<Record<string, AnyNode>>): string[] => {
    const stair = Object.values(nodes).find((node) => node.type === 'stair') as StairNode | undefined
    if (!stair) return ['no stair']
    const segments = stair.children
      .map((id) => nodes[id])
      .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
    const problems: string[] = []
    const chain = segments.map(
      (segment) =>
        `${segment.segmentType === 'stair' ? `flight ${segment.stepCount}` : 'landing'}${segment.attachmentSide === 'front' ? '' : ` ${segment.attachmentSide}`}`,
    )
    if (chain.join(', ') !== expected.chain.join(', ')) problems.push(`chain ${chain.join(', ')}`)
    for (const landing of segments.filter((segment) => segment.segmentType === 'landing'))
      if (!near(landing.length, stair.width)) problems.push(`landing ${landing.length} deep`)

    // S1: (x, z) is the middle of the bottom riser, and the first flight runs from it along the
    // climb, width / 2 to either side: the box the description gives, against the geometry's own.
    const first = segments[0]
    if (first) {
      const turn = (placed.rotation * Math.PI) / 180
      const along = rotateXZ(0, first.length, turn)
      const across = rotateXZ(stair.width / 2, 0, turn)
      const { x, z } = placed
      const corners = [
        [x - across[0], z - across[1]],
        [x + across[0], z + across[1]],
        [x - across[0] + along[0], z - across[1] + along[1]],
        [x + across[0] + along[0], z + across[1] + along[1]],
      ]
      const box = stairFootprintAABB({ ...stair, children: [first.id] }, nodes)
      const described = [
        Math.min(...corners.map(([cx]) => cx!)),
        Math.min(...corners.map(([, cz]) => cz!)),
        Math.max(...corners.map(([cx]) => cx!)),
        Math.max(...corners.map(([, cz]) => cz!)),
      ]
      const actual = box ? [box.minX, box.minZ, box.maxX, box.maxZ] : []
      if (!described.every((value, i) => near(value, actual[i] ?? Number.NaN)))
        problems.push(`first flight spans ${actual} where (x, z) says ${described}`)
    }
    const whole = stairFootprintAABB(stair, nodes)
    const reported = result.footprint as Record<string, number> | undefined
    if (
      !whole ||
      !reported ||
      !(['minX', 'minZ', 'maxX', 'maxZ'] as const).every((key) => near(whole[key], reported[key]!))
    )
      problems.push(`footprint ${JSON.stringify(reported)} against ${JSON.stringify(whole)}`)

    const railing = expected.railing ?? { mode: 'both' }
    if (stair.railingMode !== railing.mode) problems.push(`railing ${stair.railingMode}`)
    if (stair.railingStyle !== railing.style) problems.push(`railing style ${stair.railingStyle}`)
    if (stair.railingMaterialPreset !== railing.material)
      problems.push(`railing material ${stair.railingMaterialPreset}`)
    if (expected.name && stair.name !== expected.name) problems.push(`name ${stair.name}`)

    if (stair.fromLevelId !== 'level_ground') problems.push(`from ${stair.fromLevelId}`)
    if (stair.toLevelId !== expected.toLevelId) problems.push(`to ${stair.toLevelId}`)
    const openings = Object.values(nodes).filter((node) => node.type === 'floor-opening')
    if (expected.toLevelId === null) {
      if (openings.length || stair.slabOpeningMode !== 'none') problems.push('an opening is cut')
    } else if (!openings.some((opening) => opening.parentId === expected.toLevelId))
      problems.push(`no opening on ${expected.toLevelId}`)

    const rise = segments.reduce((sum, segment) => sum + segment.height, 0)
    if (expected.rise !== undefined && !near(rise, expected.rise)) problems.push(`rise ${rise}`)
    const run = segments
      .filter((segment) => segment.segmentType === 'stair')
      .reduce((sum, flight) => sum + flight.length, 0)
    if (expected.run !== undefined && !near(run, expected.run)) problems.push(`run ${run}`)
    return problems
  }
}

/** add_stair's call, kept beside the create_stair call that covers it. */
function covers(
  addStair: Record<string, unknown>,
  name: string,
  input: Record<string, unknown>,
  built: Built,
): AgentToolCase {
  const sizing = input.steps === undefined ? ", at create_stair's sizing" : ''
  return {
    name: `covers add_stair ${JSON.stringify(addStair)}: ${name}${sizing}`,
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', ...input },
    expect: {
      result: { ok: true },
      check: asAddStairBuilt(built, {
        x: input.x as number,
        z: input.z as number,
        rotation: (input.rotation as number | undefined) ?? 0,
      }),
    },
  }
}

const TO_UPPER = { toLevelId: 'level_upper' }
// A 2.8 m storey in create_stair's risers of at most 18 cm.
const FLIGHT = 'flight 16'

export const ADD_STAIR_CASES: AgentToolCase[] = [
  // The stored threads' calls: climbing north (twice), and south with railings both sides (twice).
  covers(
    { shape: 'straight', climb: 'north', width: 0.95, railing: 'right', ...TO_UPPER },
    'a flight climbing north, 0.95 m wide, a railing on the right',
    { ...TO_UPPER, x: 0.6, z: 4.9, rotation: 180, width: 0.95, railingMode: 'right' },
    { chain: [FLIGHT], railing: { mode: 'right' }, toLevelId: 'level_upper' },
  ),
  covers(
    { shape: 'straight', climb: 'south', width: 1, railing: 'both', name: 'Stair', ...TO_UPPER },
    'a flight climbing south with railings both sides, named',
    { ...TO_UPPER, x: 1, z: 0.3, width: 1, railingMode: 'both', name: 'Stair' },
    { chain: [FLIGHT], toLevelId: 'level_upper', name: 'Stair' },
  ),
  // The Architect's defaults: 3'-6" wide, a handrail on the climber's left, balusters.
  covers(
    { climb: 'east', ...TO_UPPER },
    "add_stair's defaults, climbing east",
    { ...TO_UPPER, x: 0.3, z: 2.5, rotation: 90, width: 1.067, railingMode: 'left' },
    { chain: [FLIGHT], railing: { mode: 'left' }, toLevelId: 'level_upper' },
  ),
  covers(
    { climb: 'west', railing: 'right', ...TO_UPPER },
    'climbing west',
    { ...TO_UPPER, x: 5.7, z: 2.5, rotation: 270, railingMode: 'right' },
    { chain: [FLIGHT], railing: { mode: 'right' }, toLevelId: 'level_upper' },
  ),
  // The shapes: a flight, a square landing, a flight turned 90° (L) or back beside the first (U).
  covers(
    { shape: 'L-left', climb: 'south', lowerRisers: 7, ...TO_UPPER },
    'an L turning left, 7 risers in the lower flight',
    { ...TO_UPPER, x: 1, z: 0.5, layout: 'l', turn: 'left', lowerSteps: 7 },
    { chain: ['flight 7', 'landing', 'flight 9 left'], toLevelId: 'level_upper' },
  ),
  covers(
    { shape: 'L-right', climb: 'east', ...TO_UPPER },
    'an L turning right, the risers halved',
    { ...TO_UPPER, x: 0.5, z: 4, rotation: 90, layout: 'l', turn: 'right' },
    { chain: ['flight 8', 'landing', 'flight 8 right'], toLevelId: 'level_upper' },
  ),
  covers(
    { shape: 'U-left', climb: 'north', lowerRisers: 8, ...TO_UPPER },
    'a U turning left',
    { ...TO_UPPER, x: 1, z: 4.5, rotation: 180, layout: 'u', turn: 'left', lowerSteps: 8 },
    { chain: ['flight 8', 'landing', 'landing left', 'flight 8 left'], toLevelId: 'level_upper' },
  ),
  covers(
    { shape: 'U-right', climb: 'south', ...TO_UPPER },
    'a U turning right',
    { ...TO_UPPER, x: 5, z: 0.5, layout: 'u', turn: 'right' },
    { chain: ['flight 8', 'landing', 'landing right', 'flight 8 right'], toLevelId: 'level_upper' },
  ),
  // Railings: the style, and the material by library id where add_stair took a name.
  covers(
    { railing: 'both', railingStyle: 'cable', railingMaterial: 'black', climb: 'south', ...TO_UPPER },
    'cable railings in black',
    {
      ...TO_UPPER,
      x: 3,
      z: 0.3,
      railingStyle: 'cable',
      railingMaterial: 'library:preset-nearblack',
    },
    {
      chain: [FLIGHT],
      railing: { mode: 'both', style: 'cable', material: 'library:preset-nearblack' },
      toLevelId: 'level_upper',
    },
  ),
  covers(
    { railingStyle: 'post-and-rail', railingMaterial: 'wood-plank', climb: 'south', ...TO_UPPER },
    'post-and-rail railings in wood, on the default left',
    {
      ...TO_UPPER,
      x: 3,
      z: 0.3,
      railingMode: 'left',
      railingStyle: 'post-and-rail',
      railingMaterial: 'library:wood-woodplank19',
    },
    {
      chain: [FLIGHT],
      railing: { mode: 'left', style: 'post-and-rail', material: 'library:wood-woodplank19' },
      toLevelId: 'level_upper',
    },
  ),
  covers(
    { railing: 'right', railingStyle: 'boards', railingMaterial: 'steel', climb: 'south', ...TO_UPPER },
    'board railings in steel',
    {
      ...TO_UPPER,
      x: 3,
      z: 0.3,
      railingMode: 'right',
      railingStyle: 'boards',
      railingMaterial: 'library:metal-steel',
    },
    {
      chain: [FLIGHT],
      railing: { mode: 'right', style: 'boards', material: 'library:metal-steel' },
      toLevelId: 'level_upper',
    },
  ),
  covers(
    { railingStyle: 'balusters', railingMaterial: 'wood-woodfine1', climb: 'south', ...TO_UPPER },
    'balusters in a library wood named without its prefix',
    {
      ...TO_UPPER,
      x: 3,
      z: 0.3,
      railingMode: 'left',
      railingStyle: 'balusters',
      railingMaterial: 'wood-woodfine1',
    },
    {
      chain: [FLIGHT],
      railing: { mode: 'left', style: 'balusters', material: 'library:wood-woodfine1' },
      toLevelId: 'level_upper',
    },
  ),
  covers(
    { railing: 'none', climb: 'south', ...TO_UPPER },
    'no railing',
    { ...TO_UPPER, x: 3, z: 0.3, railingMode: 'none' },
    { chain: [FLIGHT], railing: { mode: 'none' }, toLevelId: 'level_upper' },
  ),
  // The levels: without toLevelId add_stair rose the storey's height to no level and cut nothing.
  covers(
    { climb: 'south' },
    "a flight to no level, rising the storey's height",
    { x: 3, z: 0.3, toLevelId: null },
    { chain: [FLIGHT], toLevelId: null, rise: 2.8 },
  ),
  covers(
    { climb: 'south', totalRise: 1.2, width: 1.83, railing: 'none' },
    'porch steps 6 ft wide, to no level, rising 1.2 m',
    { x: 3, z: 0.3, toLevelId: null, height: 1.2, width: 1.83, railingMode: 'none' },
    { chain: ['flight 7'], railing: { mode: 'none' }, toLevelId: null, rise: 1.2 },
  ),
  // create_stair's fewest risers are the editor's own: two for a straight flight, four for an L or
  // U. The two calls add_stair served that this one does not are under them: a rise of one riser
  // (7-3/4 in or less), which it built as a single step, and an L or U of three (23-1/4 in or
  // less), flight 1, landing, flight 2, which create_stair builds with four. No stored call made
  // either.
  covers(
    { climb: 'south', totalRise: 0.38, width: 1.2 },
    'two steps up to a porch, 0.38 m',
    { x: 3, z: 0.3, toLevelId: null, height: 0.38, steps: 2, width: 1.2 },
    { chain: ['flight 2'], toLevelId: null, rise: 0.38 },
  ),
  covers(
    { climb: 'south', totalRise: 3.05, ...TO_UPPER },
    'a rise given, to the floor above',
    { ...TO_UPPER, x: 3, z: 0.3, height: 3.05 },
    { chain: ['flight 17'], toLevelId: 'level_upper', rise: 3.05 },
  ),
  // add_stair's sizing: 2.8 m in risers of at most 7-3/4 in is 15, each on a 10-1/2 in tread.
  covers(
    { climb: 'south', ...TO_UPPER },
    "add_stair's own sizing, as steps and length",
    { ...TO_UPPER, x: 3, z: 0.3, steps: 15, length: '157.5 in' },
    { chain: ['flight 15'], toLevelId: 'level_upper', run: 4.0005 },
  ),
  covers(
    { shape: 'L-right', climb: 'south', lowerRisers: 7, ...TO_UPPER },
    "an L at add_stair's sizing, 7 risers below",
    { ...TO_UPPER, x: 5, z: 0.5, layout: 'l', turn: 'right', lowerSteps: 7, steps: 15, length: '157.5 in' },
    { chain: ['flight 7', 'landing', 'flight 8 right'], toLevelId: 'level_upper', run: 4.0005 },
  ),
]
