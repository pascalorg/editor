import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { groundHoleOpenNode, SCENE_LAYER, SITE_GROUND, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { type BufferGeometry, type Mesh, type Object3D, Raycaster, Vector3 } from 'three'
import { SiteRenderer } from './renderer'

// The house covers the part of a basement under it, so the ground stands open there whatever level
// is shown: a stairwell or a walkthrough on the stair meets the basement, not a sheet of ground.
// The part of the basement reaching out under the garden stays closed until its level is shown.
// The ground is cut as geometry (the way a recessed slab is), so what is asked here is whether any
// triangle of a ground surface stands at a point.

const lot = (options: { showGround?: boolean; terrain?: boolean } = {}) =>
  SiteNode.parse({
    id: 'site_lot',
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    ...(options.showGround === undefined ? {} : { showGround: options.showGround }),
    ...(options.terrain
      ? {
          terrain: encodeTerrainField(
            createTerrainField({ origin: [-12, -12], cols: 25, rows: 25, spacing: 1 }),
          ),
        }
      : {}),
  })

type Ring = Array<[number, number]>
const rect = (x0: number, x1: number, z0: number, z1: number): Ring => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

// The house stands over x 0..6, z 0..4; the basement runs x 2..10: the part to x = 6 is under the
// house, the rest under the garden.
const HOUSE = rect(0, 6, 0, 4)
const BASEMENT = rect(2, 10, 0, 4)
const UNDER_THE_HOUSE: [number, number] = [4, 2]
const UNDER_THE_GARDEN: [number, number] = [8, 2]
const OPEN_LAWN: [number, number] = [-6, -6]

function setHouse(options: { basement?: boolean; sunkenRoom?: Ring } = {}) {
  const { basement = true, sunkenRoom } = options
  const levels = basement ? ['level_b', 'level_g'] : ['level_g']
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: levels }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      height: 3.4,
      children: ['slab_g'],
    }),
    SlabNode.parse({ id: 'slab_g', parentId: 'level_g', elevation: 0.05, polygon: HOUSE }),
  ]
  if (basement)
    nodes.push(
      LevelNode.parse({
        id: 'level_b',
        parentId: 'building_a',
        level: -1,
        baseElevation: -3.63,
        height: 3.4,
        children: sunkenRoom ? ['slab_b', 'slab_sunken'] : ['slab_b'],
      }),
      SlabNode.parse({ id: 'slab_b', parentId: 'level_b', elevation: 0.28, polygon: BASEMENT }),
    )
  // A recessed slab opens the ground when it is on the lowest level.
  if (basement && sunkenRoom)
    nodes.push(
      SlabNode.parse({
        id: 'slab_sunken',
        parentId: 'level_b',
        elevation: -0.4,
        recessed: true,
        polygon: sunkenRoom,
      }),
    )
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
}

const groundFloor = () =>
  useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade', groundMode: 'auto' })
const walkthrough = () =>
  useViewer.setState({
    belowGrade: false,
    gradeStanding: 'at-grade',
    groundMode: 'auto',
    walkthroughMode: true,
  })
const basement = (groundMode: 'auto' | 'solid' = 'auto') =>
  useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', groundMode })
const groundFloorSolid = () =>
  useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade', groundMode: 'solid' })

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
}
beforeEach(() => {
  previous = { viewer: useViewer.getState(), scene: useScene.getState() }
})
afterEach(() => {
  groundHoleOpenNode().value = 0
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
})

const drawn = (surface: Object3D) => surface.visible && surface.layers.isEnabled(SCENE_LAYER)

const solidSurfaces = (root: Object3D) => {
  const found: Mesh[] = []
  root.traverse((object) => {
    if (object.userData[SITE_GROUND] === 'solid' && drawn(object)) found.push(object as Mesh)
  })
  return found
}

/** Whether a triangle of the surface stands over the world point `(x, z)` (plan view). */
function standsOver(surface: Mesh, [x, z]: [number, number]): boolean {
  const geometry: BufferGeometry = surface.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  const corner = (i: number) => {
    const id = index ? index.getX(i) : i
    return new Vector3().fromBufferAttribute(position, id).applyMatrix4(surface.matrixWorld)
  }
  for (let i = 0; i < count; i += 3) {
    const a = corner(i)
    const b = corner(i + 1)
    const c = corner(i + 2)
    const side = (p: Vector3, q: Vector3) => (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x)
    const s1 = side(a, b)
    const s2 = side(b, c)
    const s3 = side(c, a)
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true
  }
  return false
}

/** The ground stands where: for each asked point, how many drawn ground surfaces stand over it. */
async function groundAt(
  site: SiteNode,
  display: () => void,
  points: Record<string, [number, number]>,
) {
  const renderer = await create(<SiteRenderer node={site} />)
  try {
    await act(async () => display())
    await renderer.advanceFrames(2, 0.05)
    const scene = renderer.scene.instance as Object3D
    scene.updateMatrixWorld(true)
    const surfaces = solidSurfaces(scene)
    const standing = Object.fromEntries(
      Object.entries(points).map(([name, point]) => [
        name,
        surfaces.filter((surface) => standsOver(surface, point)).length,
      ]),
    ) as Record<string, number>
    return { standing, surfaces: surfaces.length, scene }
  } finally {
    await renderer.unmount()
  }
}

const POINTS = { house: UNDER_THE_HOUSE, garden: UNDER_THE_GARDEN, lawn: OPEN_LAWN }

// Where the ground stands under the house, the garden and the lawn, by what is shown.
const WHOLE = { house: true, garden: true, lawn: true }
const OPEN_UNDER_THE_HOUSE = { house: false, garden: true, lawn: true }
test.each([
  ['the ground floor shown', groundFloor, {}, OPEN_UNDER_THE_HOUSE],
  ['the walkthrough, which tours the whole house', walkthrough, {}, OPEN_UNDER_THE_HOUSE],
  [
    'Solid with the ground floor shown: the opening is under the house',
    groundFloorSolid,
    {},
    OPEN_UNDER_THE_HOUSE,
  ],
  [
    'Solid with the walkthrough: the same',
    () => {
      groundFloorSolid()
      useViewer.setState({ walkthroughMode: true })
    },
    {},
    OPEN_UNDER_THE_HOUSE,
  ],
  [
    'Solid over a basement shown: nothing covers it with the storeys away',
    () => basement('solid'),
    {},
    WHOLE,
  ],
  ['a scene with no basement', groundFloor, { house: { basement: false } }, WHOLE],
] as const)(
  'the ground stands open under the house only: %s',
  async (_, display, options, expected) => {
    setHouse('house' in options ? options.house : {})
    const { standing } = await groundAt(lot(), display, POINTS)
    expect({
      house: standing.house > 0,
      garden: standing.garden > 0,
      lawn: standing.lawn > 0,
    }).toEqual(expected)
  },
)

test('a basement shown with the ground on Auto: the opening stays cut, and the hole of the level shown does the rest', async () => {
  setHouse()
  groundHoleOpenNode().value = 1
  const { standing } = await groundAt(lot(), () => basement(), POINTS)
  expect(standing.house).toBe(0)
  // Past the house the sheet is whole as a mesh: the shader's mask opens it, over the whole basement.
  expect(standing.garden).toBeGreaterThan(0)
})

test('on a sculpted site, with a sunken room beside the opening, the ground is cut the same way and the lawn between stays', async () => {
  setHouse({ sunkenRoom: rect(-8, -4, 5, 8) })
  const { standing, surfaces } = await groundAt(lot({ terrain: true }), groundFloor, {
    ...POINTS,
    sunken: [-6, 6.5],
    between: [-1, 6.5],
  })
  expect(surfaces).toBeGreaterThan(0)
  expect(standing.house).toBe(0)
  expect(standing.sunken).toBe(0)
  expect(standing.between).toBeGreaterThan(0)
  expect(standing.garden).toBeGreaterThan(0)
})

test('showGround off, the ground floor shown: there is no site ground to cut; with the basement shown the stand-in is cut like the rest', async () => {
  setHouse()
  expect((await groundAt(lot({ showGround: false }), groundFloor, POINTS)).surfaces).toBe(0)
  const { standing } = await groundAt(lot({ showGround: false }), () => basement(), POINTS)
  expect(standing.house).toBe(0)
  expect(standing.garden).toBeGreaterThan(0)
})

test('the opening follows the display live, and a click through it reaches what is below', async () => {
  setHouse()
  const renderer = await create(<SiteRenderer node={lot()} />)
  const scene = renderer.scene.instance as Object3D
  const at = (point: [number, number]) => {
    scene.updateMatrixWorld(true)
    return solidSurfaces(scene).some((surface) => standsOver(surface, point))
  }
  try {
    await act(async () => groundFloor())
    await renderer.advanceFrames(2, 0.05)
    expect(at(UNDER_THE_HOUSE)).toBe(false)
    // A click straight down through the opening hits no ground; past the house it does.
    const down = (point: [number, number]) =>
      new Raycaster(new Vector3(point[0], 5, point[1]), new Vector3(0, -1, 0)).intersectObjects(
        solidSurfaces(scene).filter((surface) => surface.raycast.length > 0),
        false,
      )
    expect(down(UNDER_THE_HOUSE)).toHaveLength(0)
    expect(down(UNDER_THE_GARDEN).length).toBeGreaterThan(0)
    await act(async () => basement('solid'))
    await renderer.advanceFrames(2, 0.05)
    expect(at(UNDER_THE_HOUSE)).toBe(true)
    await act(async () => groundFloor())
    await renderer.advanceFrames(2, 0.05)
    expect(at(UNDER_THE_HOUSE)).toBe(false)
  } finally {
    await renderer.unmount()
  }
})
