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
import { SCENE_LAYER, SITE_GROUND, setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
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

test('the flat lot veils its fill and the horizon disc, and keeps the lot line', async () => {
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const [solid, veil] = [ground(scene, 'solid'), ground(scene, 'veil')]
    expect([solid.length, veil.length]).toEqual([2, 2])
    expect(solid.every(drawn) && !veil.some(drawn)).toBe(true)
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ belowGrade: true }))
    expect(!solid.some(drawn) && veil.every(drawn)).toBe(true)
    expect(groundPickedFromAbove(scene)).toHaveLength(0)
    const lotLine = scene.getObjectsByProperty('type', 'Line') as Line[]
    expect(lotLine.length).toBeGreaterThan(0)
    expect(lotLine.every(drawn)).toBe(true)

    await act(async () => useViewer.setState({ belowGrade: false }))
    expect(solid.every(drawn) && !veil.some(drawn)).toBe(true)
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)
  } finally {
    await renderer.unmount()
  }
})

test("the veil is faint, unlit, seen from both sides, and leaves the scene's depth, ink and Follow's sight alone", async () => {
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

test('the person can keep the ground solid over a level below grade', async () => {
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    await act(async () => useViewer.setState({ belowGrade: true, groundMode: 'solid' }))
    expect(ground(scene, 'solid').every(drawn)).toBe(true)
    expect(ground(scene, 'veil').some(drawn)).toBe(false)
  } finally {
    await renderer.unmount()
  }
})

test('a sculpted lot veils its terrain, cut edges and skirt too', async () => {
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ belowGrade: true }))
    // The terrain's surface and skirt, and the horizon disc: no flat fill under terrain.
    const solid = ground(scene, 'solid')
    expect(solid.length).toBeGreaterThanOrEqual(3)
    expect(solid.some(drawn)).toBe(false)
    expect(ground(scene, 'veil').length).toBe(solid.length)
    expect(groundPickedFromAbove(scene)).toHaveLength(0)
  } finally {
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
