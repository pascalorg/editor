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

test('the ground’s mask is the ground window and the hole, and its colour carries the rim', async () => {
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    for (const surface of ground(renderer.scene.instance as Object3D, 'solid')) {
      const material = surface.material as MeshBasicNodeMaterial
      expect(material.maskNode).not.toBeNull()
      // The hole's own factor is in the mask: one uniform, no rebuild as it opens.
      let reads = false
      ;(
        material.maskNode as unknown as { traverse: (visit: (child: unknown) => void) => void }
      ).traverse((child) => {
        if (child === groundHoleOpenNode()) reads = true
      })
      expect(reads).toBe(true)
    }
  } finally {
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
