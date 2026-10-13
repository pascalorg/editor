import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createTerrainField, encodeTerrainField, SiteNode } from '@pascal-app/core'
import { SCENE_LAYER, SITE_GROUND, setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { type Line, type Object3D, Raycaster, Vector3 } from 'three'
import { SiteRenderer } from './renderer'

// A level below grade sets the site's ground aside: the lot's fill, its sculpted terrain and the
// horizon disc leave the picture and the picks, so the floor under them is seen and clicked; the
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

function groundSurfaces(root: Object3D): Object3D[] {
  const surfaces: Object3D[] = []
  root.traverse((object) => {
    if (object.userData[SITE_GROUND] === true) surfaces.push(object)
  })
  return surfaces
}

/** What a click straight down on the middle of the lot reaches of the ground. */
function groundPickedFromAbove(root: Object3D) {
  const ray = new Raycaster(new Vector3(0, 20, 0), new Vector3(0, -1, 0))
  setSurfaceRaycastLayers(ray.layers)
  root.updateWorldMatrix(true, true)
  return ray.intersectObject(root, true).filter((hit) => hit.object.userData[SITE_GROUND] === true)
}

let previous: ReturnType<typeof useViewer.getState>
beforeEach(() => {
  previous = useViewer.getState()
})
afterEach(() => useViewer.setState(previous, true))

test('the flat lot sets its fill and the horizon disc aside, and keeps the lot line', async () => {
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const ground = groundSurfaces(scene)
    expect(ground).toHaveLength(2)
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ groundAside: true }))
    expect(ground.every((surface) => !surface.layers.isEnabled(SCENE_LAYER))).toBe(true)
    expect(groundPickedFromAbove(scene)).toHaveLength(0)
    const lotLine = scene.getObjectsByProperty('type', 'Line') as Line[]
    expect(lotLine.length).toBeGreaterThan(0)
    expect(lotLine.every((line) => line.visible && line.layers.isEnabled(SCENE_LAYER))).toBe(true)

    await act(async () => useViewer.setState({ groundAside: false }))
    expect(ground.every((surface) => surface.layers.isEnabled(SCENE_LAYER))).toBe(true)
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)
  } finally {
    await renderer.unmount()
  }
})

test('a sculpted lot sets its terrain, cut edges and skirt aside too', async () => {
  const renderer = await create(<SiteRenderer node={lot(true)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    expect(groundPickedFromAbove(scene).length).toBeGreaterThan(0)

    await act(async () => useViewer.setState({ groundAside: true }))
    const ground = groundSurfaces(scene)
    // The terrain's surface and skirt, and the horizon disc: no flat fill under terrain.
    expect(ground.length).toBeGreaterThanOrEqual(3)
    expect(ground.every((surface) => !surface.layers.isEnabled(SCENE_LAYER))).toBe(true)
    expect(groundPickedFromAbove(scene)).toHaveLength(0)
  } finally {
    await renderer.unmount()
  }
})
