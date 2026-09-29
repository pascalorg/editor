import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { candidateEdges, hideUndrawnMeshes, materialShows } from './vector-edges'

/** A unit box's feature edges: 12, six floats each. */
const BOX_EDGE_FLOATS = 12 * 6

function sceneWithProxy() {
  const scene = new THREE.Scene()
  const house = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  // a utility-pole pick proxy: a tall box that draws nothing
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 10.7, 0.5),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  )
  proxy.position.set(3, 0, 0)
  scene.add(house, proxy)
  scene.updateMatrixWorld(true)
  return { scene, house, proxy }
}

describe('vector edges skip what draws nothing', () => {
  test('a pick proxy (colorWrite false) has no lines', () => {
    const { scene } = sceneWithProxy()
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
    const world = candidateEdges(scene, camera, 20, 400_000)
    expect(world).toHaveLength(BOX_EDGE_FLOATS)
    // every edge is the 1 m box's, none the 10.7 m proxy's
    for (let i = 1; i < world.length; i += 3)
      expect(Math.abs(world[i] as number)).toBeLessThanOrEqual(0.5)
  })

  test('hidden materials, see-through hit boxes and colour-masked colliders all count as undrawn', () => {
    expect(materialShows(new THREE.MeshBasicMaterial())).toBe(true)
    expect(materialShows(new THREE.MeshBasicMaterial({ colorWrite: false }))).toBe(false)
    expect(materialShows(new THREE.MeshBasicMaterial({ visible: false }))).toBe(false)
    expect(materialShows(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }))).toBe(
      false,
    )
    expect(
      materialShows([
        new THREE.MeshBasicMaterial({ colorWrite: false }),
        new THREE.MeshBasicMaterial(),
      ]),
    ).toBe(true)
  })

  test('the depth and normal passes see no pick proxy, and it comes back after', () => {
    const { scene, house, proxy } = sceneWithProxy()
    const show = hideUndrawnMeshes(scene)
    // under the passes' override material the proxy would write depth and
    // hide the real edges behind it
    expect(proxy.visible).toBe(false)
    expect(house.visible).toBe(true)
    show()
    expect(proxy.visible).toBe(true)
  })
})
