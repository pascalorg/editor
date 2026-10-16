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
import {
  groundHoleOpenNode,
  SCENE_LAYER,
  SITE_GROUND,
  setSurfaceRaycastLayers,
  useViewer,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Box3, DoubleSide, type Line, type Mesh, type Object3D, Raycaster, Vector3 } from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import { groundHoleDistanceAt, holeRadiusAt } from './ground-hole'
import { groundPitFloorNow } from './ground-pit'
import { SiteRenderer } from './renderer'

// Over a level below grade the site's ground is veiled: the lot's fill, its sculpted terrain and
// the horizon disc step aside for a faint veil, so the floor under them is seen and clicked; the
// lot line stays, to show where grade is.

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

function ground(root: Object3D, role: 'solid' | 'veil'): Mesh[] {
  const surfaces: Mesh[] = []
  root.traverse((object) => {
    if (object.userData[SITE_GROUND] === role) surfaces.push(object as Mesh)
  })
  return surfaces
}

/** What a click straight down on the middle of the lot reaches of the ground, solid or veil. */
function groundPickedFromAbove(root: Object3D) {
  const ray = new Raycaster(new Vector3(0, 20, 0), new Vector3(0, -1, 0))
  setSurfaceRaycastLayers(ray.layers)
  root.updateWorldMatrix(true, true)
  return ray.intersectObject(root, true).filter((hit) => hit.object.userData[SITE_GROUND])
}

const drawn = (surface: Object3D) => surface.visible && surface.layers.isEnabled(SCENE_LAYER)

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
})

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

/** What a click straight down at (x, z) reaches of the solid ground. */
function groundPickedAt(root: Object3D, x: number, z: number) {
  const ray = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0))
  setSurfaceRaycastLayers(ray.layers)
  root.updateWorldMatrix(true, true)
  return ray.intersectObject(root, true).filter((hit) => hit.object.userData[SITE_GROUND])
}

/** A basement with the villa's numbers (13 Oct): -3.63 m, on a 0.28 m plate 6 × 4 m. */
function withBasement() {
  const basement: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_b'] }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      baseElevation: -3.63,
      height: 3.4,
      children: ['slab_b'],
    }),
    SlabNode.parse({
      id: 'slab_b',
      parentId: 'level_b',
      elevation: 0.28,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    }),
  ]
  useScene.setState({
    nodes: Object.fromEntries(basement.map((node) => [node.id, node])) as Record<
      AnyNodeId,
      AnyNode
    >,
  })
}

test('over a level below grade the flat lot keeps its ground and opens a hole in it, and keeps the lot line', async () => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const solid = ground(scene, 'solid')
    const { sheets, rings } = veilsOf(scene)
    expect(solid).toHaveLength(2)
    expect(solid.every(drawn)).toBe(true)
    // At grade: no hole, so a click straight down over the plate lands on the ground.
    expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    groundHoleOpenNode().value = 1
    await renderer.advanceFrames(2, 0.05)
    // The ground stays solid, drawn: the hole is in its mask, not in the scene.
    expect(solid.every(drawn)).toBe(true)
    // No veil sheet over it: the see-through ground is the hole (the ring still draws).
    expect(sheets.filter(drawn)).toHaveLength(0)
    expect(rings.filter(drawn)).toHaveLength(1)
    // Over the plate the click falls through to the floor; past the hole's reach it lands.
    expect(groundPickedAt(scene, 3, 2)).toHaveLength(0)
    expect(groundPickedAt(scene, 9, 9).length).toBeGreaterThan(0)
    const lotLine = scene.getObjectsByProperty('type', 'Line') as Line[]
    expect(lotLine.length).toBeGreaterThan(0)
    expect(lotLine.every(drawn)).toBe(true)

    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    groundHoleOpenNode().value = 0
    await renderer.advanceFrames(2, 0.05)
    expect(solid.every(drawn)).toBe(true)
    expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test("the veil sheets are faint, unlit, seen from both sides, and leave the scene's depth, ink and Follow's sight alone", async () => {
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    for (const veil of ground(renderer.scene.instance as Object3D, 'veil')) {
      const material = veil.material as MeshBasicNodeMaterial
      expect(material.isMeshBasicNodeMaterial).toBe(true)
      expect(material.transparent).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.side).toBe(DoubleSide)
      expect(material.opacityNode).not.toBeNull()
      expect(material.mrtNode).not.toBeNull()
      // Follow's sight counts a surface over 0.1 opacity as in the way (follow-pascal-sight.ts).
      expect(material.opacity).toBeLessThanOrEqual(0.1)
      expect(veil.castShadow || veil.receiveShadow).toBe(false)
    }
  } finally {
    await renderer.unmount()
  }
})

/** True when the node graph under `root` reads the hole's opening uniform. */
function readsHoleOpening(root: unknown) {
  let reads = false
  ;(root as { traverse: (visit: (child: unknown) => void) => void }).traverse((child) => {
    if (child === groundHoleOpenNode()) reads = true
  })
  return reads
}

test('the ground’s mask is the ground window and the hole, and its colour carries the rim', async () => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    expect(useViewer.getState().hasLevelBelowGrade).toBe(true)
    const solid = ground(renderer.scene.instance as Object3D, 'solid')
    expect(solid.length).toBeGreaterThan(0)
    for (const surface of solid) {
      const material = surface.material as MeshBasicNodeMaterial
      expect(material.maskNode).not.toBeNull()
      // The hole's own factor is in the mask: one uniform, no rebuild as it opens.
      expect(readsHoleOpening(material.maskNode)).toBe(true)
    }
  } finally {
    await renderer.unmount()
  }
  expect(useViewer.getState().hasLevelBelowGrade).toBe(false)
})

test('a scene with no level below grade keeps the plain ground window mask, with no hole in it', async () => {
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    expect(useViewer.getState().hasLevelBelowGrade).toBe(false)
    for (const surface of ground(renderer.scene.instance as Object3D, 'solid')) {
      const material = surface.material as MeshBasicNodeMaterial
      expect(material.maskNode).not.toBeNull()
      expect(readsHoleOpening(material.maskNode)).toBe(false)
    }
  } finally {
    await renderer.unmount()
  }
})

// The ground materials are built once, from the moment the scene has a level below grade; going
// down to it, coming back, and the hole opening and closing are uniforms. No material is swapped,
// none is rebuilt (`version` is the count of `needsUpdate`), so no shader is compiled on the way.
test('switching floors and opening the hole swap and rebuild no ground material', async () => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const snapshot = () =>
      ground(scene, 'solid').map((surface) => {
        const material = surface.material as MeshBasicNodeMaterial
        return { surface, material, version: material.version, mask: material.maskNode }
      })
    const before = snapshot()
    expect(before.length).toBeGreaterThanOrEqual(3)

    for (const floor of [
      { belowGrade: true, gradeStanding: 'below-grade' },
      { belowGrade: false, gradeStanding: 'at-grade' },
      { belowGrade: true, gradeStanding: 'below-grade' },
      { belowGrade: true, gradeStanding: 'below-grade', groundMode: 'solid' },
      { belowGrade: true, gradeStanding: 'below-grade', groundMode: 'auto' },
    ] as const) {
      await act(async () => useViewer.setState(floor))
      groundHoleOpenNode().value = floor.belowGrade ? 1 : 0
      await renderer.advanceFrames(3, 0.05)
      const after = snapshot()
      expect(after).toHaveLength(before.length)
      after.forEach((entry, index) => {
        expect(entry.surface).toBe(before[index]?.surface)
        expect(entry.material).toBe(before[index]?.material)
        expect(entry.mask).toBe(before[index]?.mask)
        expect(entry.version).toBe(before[index]?.version ?? -1)
      })
    }
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test('the person can keep the ground solid over a level below grade', async () => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    await act(async () =>
      useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', groundMode: 'solid' }),
    )
    await renderer.advanceFrames(2, 0.05)
    expect(ground(scene, 'solid').every(drawn)).toBe(true)
    expect(ground(scene, 'veil').some(drawn)).toBe(false)
    // Solid: no hole, a click over the plate lands on the ground.
    expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)
  } finally {
    await renderer.unmount()
  }
})

test('the walkthrough walks on solid ground: no ring, no hole over the level the overview had shown', async () => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    await act(async () =>
      useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', walkthroughMode: true }),
    )
    await renderer.advanceFrames(2, 0.05)
    expect(ground(scene, 'solid').every(drawn)).toBe(true)
    expect(ground(scene, 'veil').some(drawn)).toBe(false)
    expect(groundPickedAt(scene, 3, 2).length).toBeGreaterThan(0)
    // Leaving the walkthrough: the overview rule is back (the ring under the veil).
    await act(async () => useViewer.setState({ walkthroughMode: false }))
    await renderer.advanceFrames(2, 0.05)
    expect(veilsOf(scene).rings.filter(drawn)).toHaveLength(1)
  } finally {
    useViewer.setState({ walkthroughMode: false })
    await renderer.unmount()
  }
})

test('a sculpted lot keeps its terrain, cut edges and skirt solid, and opens the hole over them too', async () => {
  withBasement()
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    groundHoleOpenNode().value = 1
    await renderer.advanceFrames(2, 0.05)
    // The terrain's surface and skirt, and the horizon disc: no flat fill under terrain.
    const solid = ground(scene, 'solid')
    expect(solid.length).toBeGreaterThanOrEqual(3)
    expect(solid.every(drawn)).toBe(true)
    expect(veilsOf(scene).sheets.filter(drawn)).toHaveLength(0)
    expect(groundPickedAt(scene, 3, 2)).toHaveLength(0)
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test('a grade ring is drawn, with the veil, where the ground meets a level below grade', async () => {
  // A basement with the villa's numbers (13 Oct): -3.63 m, on a 0.28 m plate 6 × 4 m.
  const basement: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_b'] }),
    LevelNode.parse({
      id: 'level_b',
      parentId: 'building_a',
      level: -1,
      baseElevation: -3.63,
      height: 3.4,
      children: ['slab_b'],
    }),
    SlabNode.parse({
      id: 'slab_b',
      parentId: 'level_b',
      elevation: 0.28,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    }),
  ]
  useScene.setState({
    nodes: Object.fromEntries(basement.map((node) => [node.id, node])) as Record<
      AnyNodeId,
      AnyNode
    >,
  })
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const veils = ground(scene, 'veil')
    // The fill's and the disc's veils, and the ring.
    expect(veils).toHaveLength(3)
    const ring = veils.find((veil) => {
      veil.geometry.computeBoundingBox()
      const box = veil.geometry.boundingBox ?? new Box3()
      return box.max.x - box.min.x < 7
    })
    expect(ring).toBeDefined()
    const box = ring?.geometry.boundingBox ?? new Box3()
    // The plate's outline, widened by the ribbon's half-width (8 cm) on every side.
    const on = (side: number, plateSide: number) => Math.abs(side - plateSide) < 0.1
    expect([on(box.min.x, 0), on(box.max.x, 6), on(box.min.z, 0), on(box.max.z, 4)]).toEqual([
      true,
      true,
      true,
      true,
    ])

    await act(async () => useViewer.setState({ belowGrade: true }))
    expect(ring && drawn(ring)).toBe(true)
  } finally {
    await renderer.unmount()
  }
})

test('through the ground window the solid ground stays drawn and the veil stands with it', async () => {
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    // No floor below grade: a hillside in the eye's way only (the system has said so).
    await act(async () =>
      useViewer.setState({ belowGrade: false, groundWindowVeiled: true, groundMode: 'auto' }),
    )
    // Solid stays on the scene layer — the window is cut from it per fragment — and the
    // veil sheet is up, drawing only inside the window.
    expect(ground(scene, 'solid').every(drawn)).toBe(true)
    expect(ground(scene, 'veil').every(drawn)).toBe(true)
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    // The solid surfaces carry the window's mask; the veil's opacity follows it too.
    for (const surface of ground(scene, 'solid')) {
      const material = surface.material as MeshBasicNodeMaterial
      expect(material.maskNode).not.toBeNull()
    }

    // Ground: Solid closes the window's veil as it closes the wholesale one.
    await act(async () => useViewer.setState({ groundMode: 'solid' }))
    expect(ground(scene, 'veil').some(drawn)).toBe(false)
    expect(ground(scene, 'solid').every(drawn)).toBe(true)
  } finally {
    await renderer.unmount()
  }
})

test('a click on ground the window veils falls through to what it reveals', async () => {
  const site = lot(true)
  useScene.setState({ nodes: { [site.id]: site } as Record<AnyNodeId, AnyNode> })
  const renderer = await create(<SiteRenderer node={site} />)
  try {
    const scene = renderer.scene.instance as Object3D
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    // A box under the middle of the lot (a basement plate): from the test camera the flat
    // ground stands between the eye and it, so the system opens the window for it.
    await act(async () => {
      useViewer.setState({
        groundMode: 'auto',
        groundWindowBox: { min: [-2, -3, -2], max: [2, -0.5, 2] },
      })
      await renderer.advanceFrames(3, 0.05)
    })
    expect(useViewer.getState().groundWindowVeiled).toBe(true)
    expect(groundPickedFromAbove(scene)).toHaveLength(0)

    // Ground: Solid closes the window and the ground takes clicks again.
    await act(async () => {
      useViewer.setState({ groundMode: 'solid' })
      await renderer.advanceFrames(3, 0.05)
    })
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)
  } finally {
    await renderer.unmount()
  }
})

// Several levels below grade: the owner's house over four basements (15 Oct). -1 under the house,
// -2 wider than it, -3 under part of it only, -4 offset and poking out past the house's east side.
function withFourBasements() {
  const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const footprints: Array<[number, Array<[number, number]>]> = [
    [-4, rect(4, 9, -1, 3)],
    [-3, rect(-6, -2, -6, -2)],
    [-2, rect(-8, 8, -8, 7)],
    [-1, rect(-3, 3, -3, 3)],
  ]
  const list: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      children: footprints.map(([index]) => `level_m${-index}`),
    }),
  ]
  for (const [index, polygon] of footprints)
    list.push(
      LevelNode.parse({
        id: `level_m${-index}`,
        parentId: 'building_a',
        level: index,
        height: 3,
        baseElevation: index === -4 ? -12 : 0,
        children: [`slab_m${-index}`],
      }),
      SlabNode.parse({
        id: `slab_m${-index}`,
        parentId: `level_m${-index}`,
        elevation: 0.2,
        polygon,
      }),
    )
  useScene.setState({
    nodes: Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
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

test('the hole and the grade ring follow the level shown: it and the levels between it and grade, never the deeper ones', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const ringExtents = () =>
      veilsOf(scene)
        .rings.concat(veilsOf(scene).sheets.filter((veil) => veil.geometry.boundingBox))
        .map((ring) => {
          ring.geometry.computeBoundingBox()
          const box = ring.geometry.boundingBox ?? new Box3()
          return [box.min.x, box.max.x, box.min.z, box.max.z].map((v) => Math.round(v))
        })
        .filter(([x0, x1]) => (x1 ?? 0) - (x0 ?? 0) < 19)
    // The scene has levels below grade from the start: the hole's mask is in the ground already.
    expect(useViewer.getState().hasLevelBelowGrade).toBe(true)

    await act(async () => showLevel('level_m1'))
    await renderer.advanceFrames(2, 0.05)
    // -4 pokes out east of the house: -1 shown does not open the ground over it.
    expect(groundHoleDistanceAt(0, 0)).toBeLessThan(0)
    expect(groundHoleDistanceAt(8, 1)).toBeGreaterThan(3)
    expect(groundHoleDistanceAt(-7, 6)).toBeGreaterThan(3)
    expect(ringExtents()).toEqual([[-3, 3, -3, 3]])

    await act(async () => showLevel('level_m2'))
    await renderer.advanceFrames(2, 0.05)
    // -2 is the wider level: its footprint is the hole, -3 and -1 are inside it, and -4, which pokes
    // half a metre out of it on the east, is not opened (it is deeper than the level shown).
    expect(groundHoleDistanceAt(-7, 6)).toBeLessThan(0)
    expect(groundHoleDistanceAt(8.5, 1)).toBeGreaterThan(0.3)
    expect(ringExtents()).toEqual([[-8, 8, -8, 7]])

    await act(async () => showLevel('level_m4'))
    await renderer.advanceFrames(2, 0.05)
    // -4 shown: every level above it is open too, one outline round the whole stack.
    expect(groundHoleDistanceAt(7, 1)).toBeLessThan(0)
    expect(groundHoleDistanceAt(-7, 6)).toBeLessThan(0)
    expect(ringExtents()).toEqual([[-8, 9, -8, 7]])

    // Back to the ground floor: the hole closes over the shape it had, not over another one.
    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    await renderer.advanceFrames(2, 0.05)
    expect(groundHoleDistanceAt(7, 1)).toBeLessThan(0)
  } finally {
    await renderer.unmount()
  }
})

test('over several levels below grade the stack is one hole: no island of ground where two levels overlap', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    await act(async () => showLevel('level_m4'))
    await renderer.advanceFrames(2, 0.05)
    // The middle of the house lies over -1 and -2 (and under -3's corner): overlapping outlines
    // must not cancel out (even-odd) into ground.
    for (const [x, z] of [
      [0, 0],
      [-5, -5],
      [6, 1],
      [-6, 5],
    ] as const)
      expect(groundHoleDistanceAt(x, z)).toBeLessThan(0)
  } finally {
    await renderer.unmount()
  }
})

test('switching between a shallow and the deepest level swaps and rebuilds no ground material', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const snapshot = () =>
      ground(scene, 'solid').map((surface) => {
        const material = surface.material as MeshBasicNodeMaterial
        return { surface, material, version: material.version, mask: material.maskNode }
      })
    const before = snapshot()
    expect(before.length).toBeGreaterThanOrEqual(3)
    for (const levelId of [
      'level_m1',
      'level_m4',
      'level_m2',
      'level_m1',
      'level_m3',
      'level_m4',
    ]) {
      await act(async () => showLevel(levelId))
      groundHoleOpenNode().value = 1
      await renderer.advanceFrames(3, 0.05)
      const after = snapshot()
      expect(after).toHaveLength(before.length)
      after.forEach((entry, index) => {
        expect(entry.surface).toBe(before[index]?.surface)
        expect(entry.material).toBe(before[index]?.material)
        expect(entry.mask).toBe(before[index]?.mask)
        expect(entry.version).toBe(before[index]?.version ?? -1)
      })
    }
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
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

test('the pit’s walls stand on the hole’s contour and go down to the floor of the level shown', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const floors: number[] = []
    for (const levelId of ['level_m4', 'level_m2', 'level_m1']) {
      await act(async () => showLevel(levelId))
      groundHoleOpenNode().value = 1
      await renderer.advanceFrames(3, 0.05)
      const walls = pitWalls(scene)
      expect(walls).toHaveLength(1)
      const position = walls[0]!.geometry.getAttribute('position')
      expect(position.count).toBeGreaterThan(400)
      // Every wall's top is on the threshold the ground's mask cuts: distance = radius.
      for (let i = 0; i < position.count; i += 97) {
        const [x, z] = [position.getX(i), position.getZ(i)]
        expect(Math.abs(groundHoleDistanceAt(x, z) - holeRadiusAt(x, z))).toBeLessThan(0.08)
      }
      floors.push(groundPitFloorNow())
    }
    // -4 sits 12 m down (its 0.2 m plate on top); the floor rises as the shallower levels are shown.
    expect(floors[0]).toBeCloseTo(-11.8, 1)
    expect(floors[1]!).toBeGreaterThan(floors[0]! + 5)
    expect(floors[2]!).toBeGreaterThanOrEqual(floors[1]!)
    expect(floors[2]!).toBeLessThan(0)
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test('switching floors changes the pit’s uniforms and geometry, never its meshes or materials', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const snapshot = () =>
      pitParts(scene).map((part) => {
        const material = part.material as MeshBasicNodeMaterial
        return { part, material, version: material.version, kind: part.userData.groundPit }
      })
    await act(async () => showLevel('level_m1'))
    await renderer.advanceFrames(3, 0.05)
    const before = snapshot()
    expect(before.map((entry) => entry.kind).sort()).toEqual(['floor', 'walls'])
    for (const levelId of ['level_m4', 'level_m2', 'level_m1', 'level_m3', 'level_m4']) {
      await act(async () => showLevel(levelId))
      groundHoleOpenNode().value = 1
      await renderer.advanceFrames(3, 0.05)
      const after = snapshot()
      expect(after).toHaveLength(before.length)
      after.forEach((entry, index) => {
        expect(entry.part).toBe(before[index]?.part)
        expect(entry.material).toBe(before[index]?.material)
        expect(entry.version).toBe(before[index]?.version ?? -1)
      })
    }
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test('every edge look puts the walls on its own contour and changes uniforms, never a mesh or a material', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    await act(async () => showLevel('level_m2'))
    groundHoleOpenNode().value = 1
    await renderer.advanceFrames(3, 0.05)
    const snapshot = () =>
      [...pitParts(scene), ...ground(scene, 'solid')].map((part) => {
        const material = part.material as MeshBasicNodeMaterial
        return { part, material, version: material.version, mask: material.maskNode }
      })
    const before = snapshot()
    const geometries = new Set<unknown>()
    for (const edge of ['section', 'quiet', 'section-hatch', 'noise', 'section'] as const) {
      await act(async () => useViewer.getState().setUndergroundLook({ edge }))
      await renderer.advanceFrames(3, 0.05)
      const after = snapshot()
      expect(after).toHaveLength(before.length)
      after.forEach((entry, index) => {
        expect(entry.part).toBe(before[index]?.part)
        expect(entry.material).toBe(before[index]?.material)
        expect(entry.mask).toBe(before[index]?.mask)
        expect(entry.version).toBe(before[index]?.version ?? -1)
      })
      const position = pitWalls(scene)[0]!.geometry.getAttribute('position')
      geometries.add(pitWalls(scene)[0]!.geometry)
      expect(position.count).toBeGreaterThan(400)
      // The section cut is a constant offset of the footprint (0.6 m): straight, no noise.
      const offset = edge.startsWith('section') ? 0.6 : null
      for (let i = 0; i < position.count; i += 97) {
        const [x, z] = [position.getX(i), position.getZ(i)]
        expect(Math.abs(groundHoleDistanceAt(x, z) - holeRadiusAt(x, z))).toBeLessThan(0.08)
        if (offset !== null) expect(holeRadiusAt(x, z)).toBe(offset)
      }
    }
    // The walls are cut again for each look, on the same meshes.
    expect(geometries.size).toBeGreaterThan(1)
  } finally {
    useViewer.getState().setUndergroundLook({ edge: 'noise' })
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test('the eye under the ground sees no pit, and the pit is back when it surfaces', async () => {
  withFourBasements()
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
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
  } finally {
    groundHoleOpenNode().value = 0
    await renderer.unmount()
  }
})

test('a scene with no level below grade has no pit', async () => {
  useScene.setState({ nodes: {} as Record<AnyNodeId, AnyNode> })
  const plain = await create(<SiteRenderer node={lot(false)} />)
  try {
    expect(pitParts(plain.scene.instance as Object3D)).toHaveLength(0)
  } finally {
    await plain.unmount()
  }
})
