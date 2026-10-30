import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  GROUND_PIT_PLATE_CLEARANCE,
  genericFoundation,
  groundPitFloorY,
  LevelNode,
  SiteNode,
  SlabNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  groundHoleOpenNode,
  groundWindowBoxNow,
  SCENE_LAYER,
  SITE_GROUND,
  setSurfaceRaycastLayers,
  useViewer,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Box3, type Line, type Mesh, type Object3D, Raycaster, Vector3 } from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import { groundHoleDistanceAt, holeRadiusAt } from './ground-hole'
import { groundPitDrawnFloorNow, groundPitFloorNow } from './ground-pit'
import { SiteRenderer } from './renderer'

// Over a level below grade the site's ground stays solid and opens a hole over it, so the floor
// under it is seen and clicked; the lot line stays, to show where grade is.

const lotPoints: Array<[number, number]> = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
]

function lot(withTerrain: boolean) {
  const terrain = encodeTerrainField(
    createTerrainField({ origin: [-12, -12], cols: 25, rows: 25, spacing: 1 }),
  )
  return SiteNode.parse({
    id: 'site_lot',
    polygon: { type: 'polygon', points: lotPoints },
    ...(withTerrain ? { terrain } : {}),
  })
}

const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

function setNodes(list: AnyNode[]) {
  useScene.setState({
    nodes: Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
}

function ground(root: Object3D, role: 'solid' | 'veil'): Mesh[] {
  const surfaces: Mesh[] = []
  root.traverse((object) => {
    if (object.userData[SITE_GROUND] === role) surfaces.push(object as Mesh)
  })
  return surfaces
}

/** What a click straight down at (x, z) reaches of the ground, solid or veil. */
function groundPickedAt(root: Object3D, x = 0, z = 0) {
  const ray = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0))
  setSurfaceRaycastLayers(ray.layers)
  root.updateWorldMatrix(true, true)
  return ray.intersectObject(root, true).filter((hit) => hit.object.userData[SITE_GROUND])
}

const drawn = (surface: Object3D) => surface.visible && surface.layers.isEnabled(SCENE_LAYER)

/** The veil surfaces told apart: the grade ring is the narrow one, the sheets cover the lot. */
function veilsOf(root: Object3D) {
  const veils = ground(root, 'veil')
  const isRing = (veil: Mesh) => {
    veil.geometry.computeBoundingBox()
    const box = veil.geometry.boundingBox ?? new Box3()
    return box.max.x - box.min.x < 7
  }
  return { sheets: veils.filter((veil) => !isRing(veil)), rings: veils.filter(isRing) }
}

/** True when the node graph under `root` reads the hole's opening uniform. */
function readsHoleOpening(root: unknown) {
  let reads = false
  ;(root as { traverse: (visit: (child: unknown) => void) => void }).traverse((child) => {
    if (child === groundHoleOpenNode()) reads = true
  })
  return reads
}
const solidMasks = (root: Object3D) =>
  ground(root, 'solid').map((surface) => (surface.material as MeshBasicNodeMaterial).maskNode)

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
}
beforeEach(() => {
  previous = { viewer: useViewer.getState(), scene: useScene.getState() }
})
afterEach(() => {
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
  groundHoleOpenNode().value = 0
})

/** A level of building_a with its slab: `base` and `height` as the stack gives them, `elevation` the slab's. */
function storey(
  id: string,
  level: number,
  polygon: Array<[number, number]>,
  { base = 0, height = 3, elevation = 0.2 } = {},
): AnyNode[] {
  return [
    LevelNode.parse({
      id: `level_${id}`,
      parentId: 'building_a',
      level,
      height,
      ...(base ? { baseElevation: base } : {}),
      children: [`slab_${id}`],
    }),
    SlabNode.parse({ id: `slab_${id}`, parentId: `level_${id}`, elevation, polygon }),
  ]
}

/** A basement with the villa's numbers (13 Oct): -3.63 m, on a 0.28 m plate 6 × 4 m. */
function withBasement() {
  setNodes([
    BuildingNode.parse({ id: 'building_a', children: ['level_b'] }),
    ...storey('b', -1, rect(0, 6, 0, 4), { base: -3.63, height: 3.4, elevation: 0.28 }),
  ])
}

test.each([false, true])(
  'over a level below grade the ground stays solid and opens a hole: the basement is clicked through it, and the lot line stays (terrain: %p)',
  async (withTerrain) => {
    withBasement()
    const renderer = await create(<SiteRenderer node={lot(withTerrain)} />)
    const scene = renderer.scene.instance as Object3D
    const solid = ground(scene, 'solid')
    expect(useViewer.getState().hasLevelBelowGrade).toBe(true)
    expect(solid.length).toBeGreaterThanOrEqual(withTerrain ? 3 : 2)
    // The hole's own factor is in every ground's mask: one uniform, no rebuild as it opens.
    expect(solidMasks(scene).every(readsHoleOpening)).toBe(true)
    // At grade: no hole, so a click straight down over the plate lands on the ground.
    expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    groundHoleOpenNode().value = 1
    await renderer.advanceFrames(2, 0.05)
    // The ground stays solid and drawn (the hole is in its mask), no veil sheet over it, the grade
    // ring where it meets the plate, drawn along the plate's outline (the ribbon's half-width
    // widens it by 8 cm).
    expect(solid.every(drawn)).toBe(true)
    const { sheets, rings } = veilsOf(scene)
    expect(sheets.filter(drawn)).toHaveLength(0)
    expect(rings.filter(drawn)).toHaveLength(1)
    const ring = rings[0]?.geometry.boundingBox ?? new Box3()
    expect(
      [ring.min.x, ring.max.x, ring.min.z, ring.max.z].map((v) => Math.abs(Math.round(v))),
    ).toEqual([0, 6, 0, 4])
    // Over the plate the click falls through to the floor; past the hole's reach it lands.
    expect(groundPickedAt(scene, 3, 2)).toHaveLength(0)
    expect(groundPickedAt(scene, 9, 9).length).toBeGreaterThan(0)
    const lotLine = scene.getObjectsByProperty('type', 'Line') as Line[]
    expect(lotLine.length).toBeGreaterThan(0)
    expect(lotLine.every(drawn)).toBe(true)

    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    groundHoleOpenNode().value = 0
    await renderer.advanceFrames(2, 0.05)
    expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)
    await renderer.unmount()
  },
)

test.each([
  ['the person keeps the ground Solid', { groundMode: 'solid' }],
  ['the walkthrough walks', { walkthroughMode: true }],
] as const)('no hole and no veil over a level below grade when %s', async (_, state) => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  const scene = renderer.scene.instance as Object3D
  await act(async () =>
    useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', ...state }),
  )
  await renderer.advanceFrames(2, 0.05)
  expect(ground(scene, 'solid').every(drawn)).toBe(true)
  expect(ground(scene, 'veil').some(drawn)).toBe(false)
  expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)
  // Leaving the walkthrough: the overview rule is back (the ring under the veil).
  if ('walkthroughMode' in state) {
    await act(async () => useViewer.setState({ walkthroughMode: false }))
    await renderer.advanceFrames(2, 0.05)
    expect(veilsOf(scene).rings.filter(drawn)).toHaveLength(1)
  }
  await renderer.unmount()
})

test('through the ground window (a hillside in the eye’s way) the ground stays drawn, the faint veil stands in the window, a click falls through, and Solid closes it', async () => {
  const site = lot(true)
  setNodes([site])
  const renderer = await create(<SiteRenderer node={site} />)
  const scene = renderer.scene.instance as Object3D
  expect(groundPickedAt(scene).length).toBeGreaterThan(0)
  // A box under the middle of the lot (a basement plate): from the test camera the flat ground
  // stands between the eye and it, so the system opens the window for it.
  await act(async () => {
    useViewer.setState({
      belowGrade: false,
      groundMode: 'auto',
      groundWindowBox: { min: [-2, -3, -2], max: [2, -0.5, 2] },
    })
    await renderer.advanceFrames(3, 0.05)
  })
  expect(useViewer.getState().groundWindowVeiled).toBe(true)
  expect(ground(scene, 'solid').every(drawn)).toBe(true)
  expect(ground(scene, 'veil').every(drawn)).toBe(true)
  // The veil is faint (Follow's sight counts a surface over 0.1 opacity as in the way) and writes
  // no depth.
  for (const veil of ground(scene, 'veil')) {
    const material = veil.material as MeshBasicNodeMaterial
    expect(material.opacity).toBeLessThanOrEqual(0.1)
    expect(material.depthWrite).toBe(false)
  }
  expect(groundPickedAt(scene)).toHaveLength(0)

  await act(async () => {
    useViewer.setState({ groundMode: 'solid' })
    await renderer.advanceFrames(3, 0.05)
  })
  expect(ground(scene, 'veil').some(drawn)).toBe(false)
  expect(groundPickedAt(scene).length).toBeGreaterThan(0)
  await renderer.unmount()
})

test('a level shown fully below grade is seen through the hole: no window opens over it, on any terrain', async () => {
  // Any terrain field asks for a window (a custom terrain, a pad, a retaining break), the flat one
  // here included; the window cuts the solid ground in the box's silhouette and shows the level
  // through a translucent sheet in front of the opening, where the hole already shows it.
  const site = lot(true)
  useScene.setState({ nodes: { [site.id]: site } as Record<AnyNodeId, AnyNode> })
  const renderer = await create(<SiteRenderer node={site} />)
  const settle = async (state: Partial<ReturnType<typeof useViewer.getState>>) =>
    act(async () => {
      useViewer.setState(state)
      await renderer.advanceFrames(3, 0.05)
    })
  try {
    const box = { min: [-2, -3, -2], max: [2, -0.5, 2] } as const
    await settle({ groundWindowBox: box, groundMode: 'auto', belowGrade: false })
    // At grade (the ground in the eye's way): the window opens.
    expect(useViewer.getState().groundWindowVeiled).toBe(true)
    expect(groundWindowBoxNow()).not.toBeNull()

    // A level fully below grade shown: the hole is the opening, the ground solid round it.
    await settle({ belowGrade: true, gradeStanding: 'below-grade' })
    expect(useViewer.getState().groundWindowVeiled).toBe(false)
    expect(groundWindowBoxNow()).toBeNull()
    expect(ground(renderer.scene.instance as Object3D, 'veil').filter((v) => v.visible)).toEqual([])

    // Only partly below grade (a walk-out): the hole is not cut wholesale, the window is.
    await settle({ gradeStanding: 'partly-below-grade' })
    expect(useViewer.getState().groundWindowVeiled).toBe(true)
    expect(groundWindowBoxNow()).not.toBeNull()

    // Ground: Solid over the level below grade: no window either, as before.
    await settle({ gradeStanding: 'below-grade', groundMode: 'solid' })
    expect(groundWindowBoxNow()).toBeNull()
  } finally {
    await renderer.unmount()
  }
})

// Several levels below grade: the owner's house over four basements (15 Oct). -1 under the house,
// -2 wider than it, -3 under part of it only, -4 offset and poking out past the house's east side.
function withFourBasements() {
  const plans: Array<[number, Array<[number, number]>]> = [
    [-4, rect(4, 9, -1, 3)],
    [-3, rect(-6, -2, -6, -2)],
    [-2, rect(-8, 8, -8, 7)],
    [-1, rect(-3, 3, -3, 3)],
  ]
  setNodes([
    BuildingNode.parse({ id: 'building_a', children: plans.map(([n]) => `level_m${-n}`) }),
    ...plans.flatMap(([n, polygon]) => storey(`m${-n}`, n, polygon, { base: n === -4 ? -12 : 0 })),
  ])
}

/** Shows `levelId` the way the level display does: the levels above it hidden, its ground veiled. */
function showLevel(levelId: string) {
  return useViewer.setState({
    selection: { ...useViewer.getState().selection, levelId } as never,
    hideLevelsAboveSelection: true,
    belowGrade: true,
    gradeStanding: 'below-grade',
  })
}

test('the hole follows the level shown (it and the levels between it and grade, never the deeper ones) and is one outline', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  const scene = renderer.scene.instance as Object3D
  // The grade ring's extent, rounded: the lot's own sheets are the wide ones.
  const ringExtents = () =>
    ground(scene, 'veil')
      .map((veil) => {
        veil.geometry.computeBoundingBox()
        const box = veil.geometry.boundingBox ?? new Box3()
        return [box.min.x, box.max.x, box.min.z, box.max.z].map((v) => Math.round(v))
      })
      .filter(([x0, x1]) => (x1 ?? 0) - (x0 ?? 0) < 19)
  expect(useViewer.getState().hasLevelBelowGrade).toBe(true)
  groundHoleOpenNode().value = 1

  await act(async () => showLevel('level_m1'))
  await renderer.advanceFrames(2, 0.05)
  // -4 pokes out east of the house: -1 shown does not open the ground over it.
  expect(groundHoleDistanceAt(0, 0)).toBeLessThan(0)
  expect(groundHoleDistanceAt(8, 1)).toBeGreaterThan(3)
  expect(groundHoleDistanceAt(-7, 6)).toBeGreaterThan(3)
  expect(ringExtents()).toEqual([[-3, 3, -3, 3]])
  // The pit goes down to the floor of the level shown, which is shallow here.
  expect(groundPitFloorNow()).toBeLessThan(0)
  expect(groundPitFloorNow()).toBeGreaterThan(-4)

  await act(async () => showLevel('level_m2'))
  await renderer.advanceFrames(2, 0.05)
  // -2 is the wider level: -3 and -1 are inside it, and -4, which pokes half a metre out of it on the
  // east, is not opened (it is deeper than the level shown).
  expect(groundHoleDistanceAt(-7, 6)).toBeLessThan(0)
  expect(groundHoleDistanceAt(8.5, 1)).toBeGreaterThan(0.3)
  expect(ringExtents()).toEqual([[-8, 8, -8, 7]])

  await act(async () => showLevel('level_m4'))
  await renderer.advanceFrames(2, 0.05)
  // -4 shown: every level above it is open too, and the middle of the house, over -1 and -2 (under
  // -3's corner), is no island of ground where overlapping outlines cancel out.
  for (const [x, z] of [
    [7, 1],
    [-7, 6],
    [0, 0],
    [-5, -5],
    [6, 1],
    [-6, 5],
  ] as const)
    expect(groundHoleDistanceAt(x, z)).toBeLessThan(0)
  expect(ringExtents()).toEqual([[-8, 9, -8, 7]])
  // -4 sits 12 m down (its 0.2 m plate on top).
  expect(groundPitFloorNow()).toBeCloseTo(-11.8, 1)

  // Back to the ground floor: the hole closes over the shape it had, not over another one.
  await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
  await renderer.advanceFrames(2, 0.05)
  expect(groundHoleDistanceAt(7, 1)).toBeLessThan(0)
  await renderer.unmount()
})

// The pit: over a deep level the hole is the ground cut open, its walls standing on the hole's own
// contour down to the floor of the level shown (ground-pit.tsx).
function pitParts(root: Object3D) {
  const parts: Mesh[] = []
  root.traverse((object) => {
    if (object.userData.groundPit) parts.push(object as Mesh)
  })
  return parts
}
const pitWalls = (root: Object3D) =>
  pitParts(root).filter((part) => part.userData.groundPit === 'walls')

test('switching levels, ground mode and the edge look rebuilds no material and swaps no mesh: a floor switch compiles nothing', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  const scene = renderer.scene.instance as Object3D
  await act(async () => showLevel('level_m2'))
  groundHoleOpenNode().value = 1
  await renderer.advanceFrames(3, 0.05)
  const snapshot = () =>
    [...ground(scene, 'solid'), ...pitParts(scene)].map((part) => {
      const material = part.material as MeshBasicNodeMaterial
      return { part, material, version: material.version, mask: material.maskNode }
    })
  const before = snapshot()
  expect(before.length).toBeGreaterThanOrEqual(5)
  expect(
    pitParts(scene)
      .map((part) => part.userData.groundPit)
      .sort(),
  ).toEqual(['floor', 'walls'])
  const geometries = new Set<unknown>()
  const steps: Array<[string, Partial<ReturnType<typeof useViewer.getState>>, string | null]> = [
    [
      'm1',
      { selection: { ...useViewer.getState().selection, levelId: 'level_m1' } as never },
      null,
    ],
    [
      'm4',
      { selection: { ...useViewer.getState().selection, levelId: 'level_m4' } as never },
      null,
    ],
    ['at grade', { belowGrade: false, gradeStanding: 'at-grade' }, null],
    ['below again', { belowGrade: true, gradeStanding: 'below-grade' }, null],
    ['Solid', { groundMode: 'solid' }, null],
    ['Auto', { groundMode: 'auto' }, null],
    ['quiet look', {}, 'quiet'],
    ['section-earth look', {}, 'section-earth'],
    ['section look', {}, 'section'],
  ]
  for (const [, state, edge] of steps) {
    await act(async () => {
      useViewer.setState(state)
      if (edge) useViewer.getState().setUndergroundLook({ edge: edge as 'quiet' })
    })
    groundHoleOpenNode().value = 1
    await renderer.advanceFrames(3, 0.05)
    const after = snapshot()
    expect(after).toHaveLength(before.length)
    after.forEach((entry, index) => {
      expect(entry.part).toBe(before[index]?.part)
      expect(entry.material).toBe(before[index]?.material)
      expect(entry.mask).toBe(before[index]?.mask)
      expect(entry.version).toBe(before[index]?.version ?? -1)
    })
    if (edge) {
      // Each look cuts the walls again on the same meshes, on the hole's own contour.
      const walls = pitWalls(scene)[0]!
      geometries.add(walls.geometry)
      const position = walls.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i += 193) {
        const [x, z] = [position.getX(i), position.getZ(i)]
        expect(Math.abs(groundHoleDistanceAt(x, z) - holeRadiusAt(x, z))).toBeLessThan(0.08)
      }
    }
  }
  expect(geometries.size).toBeGreaterThan(1)
  useViewer.getState().setUndergroundLook({ edge: 'noise' })
  await renderer.unmount()
})

/**
 * A basement on the default 0.05 m plate, as a person draws one: the building seated 2.697 m down,
 * the plate out to the walls' outer faces, a ground floor over it. The footing under it tops out
 * at the plate's underside, which is where the pit's floor used to be drawn.
 */
function withSeatedBasement() {
  const corners: Array<[number, number]> = [
    [-5.875, -4.875],
    [5.875, -4.875],
    [5.875, 4.875],
    [-5.875, 4.875],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_b${index}`,
      parentId: 'level_b',
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.25,
    }),
  )
  const polygon: Array<[number, number]> = [
    [-6, -5],
    [6, -5],
    [6, 5],
    [-6, 5],
  ]
  const list: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      position: [0, -2.697, 0],
      children: ['level_b', 'level_g'],
    }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      height: 2.9,
      children: [...walls.map((wall) => wall.id), 'slab_b'],
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      height: 2.8,
      children: ['slab_g'],
    }),
    SlabNode.parse({
      id: 'slab_b',
      parentId: 'level_b',
      polygon,
      elevation: 0.05,
      thickness: 0.05,
    }),
    SlabNode.parse({ id: 'slab_g', parentId: 'level_g', polygon, elevation: 0.05 }),
    ...walls,
  ]
  useScene.setState({
    nodes: Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
}

test('the pit draws its floor off the plane the footing under the basement stops on', async () => {
  withSeatedBasement()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  await act(async () => showLevel('level_b'))
  groundHoleOpenNode().value = 1
  await renderer.advanceFrames(3, 0.05)
  const { nodes } = useScene.getState()
  const footings = genericFoundation(nodes).filter((member) => member.kind === 'footing')
  expect(footings).toHaveLength(4)
  // What the pit draws is what core says, and the footing's top is not on its plane.
  expect(groundPitDrawnFloorNow()).toBeCloseTo(groundPitFloorY(nodes, 'level_b') ?? Number.NaN, 9)
  for (const footing of footings)
    expect(Math.abs(footing.topY - groundPitDrawnFloorNow())).toBeGreaterThanOrEqual(
      GROUND_PIT_PLATE_CLEARANCE - 1e-9,
    )
  // The pit still goes down to the floor of the level shown (the floor top, -2.647).
  expect(groundPitFloorNow()).toBeCloseTo(-2.647, 3)
  await renderer.unmount()
})

/**
 * The hillside house of the core tests (`below-grade-footprints.test.ts`): ground at 0 m west of
 * x = 0 and 4 m east of it, the terrain in the scene so the levels read it. A cellar (-2, x -2..5)
 * under the ground everywhere, a walk-out over it (-1, floor 0.2 m, x -9..`walkoutEast`) buried only
 * on the east.
 */
function withHillsideHouse(walkoutEast: number) {
  const field = createTerrainField({ origin: [-12, -12], cols: 25, rows: 25, spacing: 1 })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row += 1)
    for (let col = 0; col < field.cols; col += 1)
      if (field.origin[0] + col * field.spacing >= 0) heights[row * field.cols + col] = 400
  const site = SiteNode.parse({
    id: 'site_lot',
    polygon: { type: 'polygon', points: lotPoints },
    terrain: encodeTerrainField({ ...field, heights }),
    children: ['building_a'],
  })
  setNodes([
    site,
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_lot',
      children: ['level_cellar', 'level_walkout'],
    }),
    ...storey('cellar', -2, rect(-2, 5, -4, 4), { base: -3 }),
    ...storey('walkout', -1, rect(-9, walkoutEast, -4, 4)),
  ])
  return site
}

test('on a hillside the hole, the grade ring and the pit stop where the ground does: the valley side of a walk-out stays closed', async () => {
  const site = withHillsideHouse(9)
  const renderer = await create(<SiteRenderer node={site} />)
  const scene = renderer.scene.instance as Object3D
  await act(async () => showLevel('level_cellar'))
  groundHoleOpenNode().value = 1
  await renderer.advanceFrames(3, 0.05)

  // The cellar (x -2..5) and the walk-out's buried part past it (to x = 9) are open; the walk-out's
  // valley side (x -9..-2, the ground at 0 m, under its floor) is not.
  expect(groundHoleDistanceAt(3, 0)).toBeLessThan(0)
  expect(groundHoleDistanceAt(7, 0)).toBeLessThan(0)
  expect(groundHoleDistanceAt(-6, 0)).toBeGreaterThan(1)

  // The grade ring runs along the same outline. (The sheets are transparent: the terrain's cut
  // round the opening under the walk-out, where the house covers the cellar, is one of them.)
  const rings = ground(scene, 'veil').filter((veil) => {
    veil.geometry.computeBoundingBox()
    const box = veil.geometry.boundingBox ?? new Box3()
    return box.max.x - box.min.x < 15 && !(veil.material as { transparent?: boolean }).transparent
  })
  expect(rings).toHaveLength(1)
  const ringBox = rings[0]!.geometry.boundingBox ?? new Box3()
  expect(ringBox.min.x).toBeGreaterThan(-2.5)
  expect(ringBox.max.x).toBeLessThan(9.5)

  await renderer.unmount()
})

test('the eye under the ground sees no pit, and the pit is back when it surfaces', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  const scene = renderer.scene.instance as Object3D
  await act(async () => showLevel('level_m4'))
  groundHoleOpenNode().value = 1
  await renderer.advanceFrames(2, 0.05)
  expect(pitParts(scene).map((part) => part.visible)).toEqual([true, true])
  await act(async () => useViewer.setState({ eyeUnderGround: true }))
  await renderer.advanceFrames(2, 0.05)
  expect(pitParts(scene).map((part) => part.visible)).toEqual([false, false])
  await act(async () => useViewer.setState({ eyeUnderGround: false }))
  await renderer.advanceFrames(2, 0.05)
  expect(pitParts(scene).map((part) => part.visible)).toEqual([true, true])
  await renderer.unmount()
})

test('a scene with no level below grade has no hole and no pit', async () => {
  setNodes([])
  const plain = await create(<SiteRenderer node={lot(false)} />)
  expect(useViewer.getState().hasLevelBelowGrade).toBe(false)
  const masks = solidMasks(plain.scene.instance as Object3D)
  expect(masks.length).toBeGreaterThan(0)
  // The plain ground window mask, with no hole in it.
  expect(masks.every((mask) => mask !== null && !readsHoleOpening(mask))).toBe(true)
  expect(pitParts(plain.scene.instance as Object3D)).toHaveLength(0)
  await plain.unmount()
})
