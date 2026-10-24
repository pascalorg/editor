import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { buildDesign, runDesign } from './design'

const HOUSE = `
import * as THREE from 'three'
export const title = 'Test house'
export default function build({ THREE, piece }) {
  const house = new THREE.Group()
  const plaster = new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 0.8 })
  plaster.name = 'Plaster'
  const wall = new THREE.Group()
  wall.name = 'wall:north'
  wall.position.set(0, 0, -3)
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.7, 0.2), plaster)
  body.position.y = 1.35
  wall.add(body)
  house.add(wall)
  const moved = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const crate = new THREE.Mesh(moved, plaster)
  crate.name = 'crate'
  house.add(crate)
  const door = new THREE.Group()
  door.name = 'Door: front'
  const leaf = new THREE.Group()
  leaf.name = 'leaf'
  leaf.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.04), plaster))
  door.add(leaf)
  door.animations = [new THREE.AnimationClip('open', 1, [new THREE.NumberKeyframeTrack('leaf.rotation[y]', [0, 1], [0, -1.5])])]
  house.add(door)
  const table = new THREE.Group()
  table.position.set(2, 0, 1)
  table.rotation.y = Math.PI / 2
  table.add(piece('oak table, round, one pedestal', { position: [0, 0, 0], size: [1.2, 0.75, 1.2] }))
  house.add(table)
  piece('wall clock, brass', { position: [0, 2, -2.9], size: [0.4, 0.4, 0.05], mount: 'wall-side' })
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.02, 0.3), plaster, 2)
  tiles.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0.3, 0, 0))
  tiles.setColorAt(0, new THREE.Color('#ff0000'))
  tiles.setColorAt(1, new THREE.Color('#00ff00'))
  house.add(tiles)
  const lamp = new THREE.PointLight('#ffe2b8', 2, 6)
  lamp.position.set(0, 2.4, 0)
  house.add(lamp)
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plaster)
  ghost.visible = false
  house.add(ghost)
  return house
}`

describe('runDesign', () => {
  test('answers each piece the design delegated, nested or never added, and what it built', async () => {
    const summary = await runDesign({ code: HOUSE })
    expect(summary.pieces).toEqual([
      { description: 'oak table, round, one pedestal', size: [1.2, 0.75, 1.2], mount: 'floor' },
      { description: 'wall clock, brass', size: [0.4, 0.4, 0.05], mount: 'wall-side' },
    ])
    // The wall, the crate, the leaf and two instanced tiles; the hidden box is counted, not kept.
    expect(summary.stats).toEqual({ meshes: 5, triangles: 60 })
    expect(summary.skipped).toEqual({ 'hidden objects': 1 })
  })

  test("runs Pascal Arena's build({ THREE, scene, addons }) and counts the addons Pascal lacks", async () => {
    const code = `export function build({ THREE, scene, addons }) {
      const merged = addons.mergeGeometries([new THREE.BoxGeometry(1, 1, 1)])
      scene.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial()))
      addons.TextGeometry
    }`
    expect((await runDesign({ code })).skipped).toEqual({
      "uses of addons.TextGeometry, which Pascal's compiler does not carry": 1,
    })
  })

  test('refuses what a module may not do, a module with no build, and one that builds nothing', async () => {
    await expect(
      runDesign({ code: 'export default function build() { return eval("1") }' }),
    ).rejects.toThrow(/dynamic import, eval/)
    await expect(
      runDesign({
        code: "export default function build({ THREE, piece }) { piece('x', {}); return new THREE.Group() }",
      }),
    ).rejects.toThrow(/size must be/)
    await expect(runDesign({ code: 'export const x = 1' })).rejects.toThrow('must export')
    await expect(runDesign({ code: 'export function build() {}' })).rejects.toThrow(
      'added nothing to the scene',
    )
  })
})

describe('buildDesign', () => {
  test('stands each piece where the design put it, in the scene it built', async () => {
    const { scene, pieces } = await buildDesign(HOUSE)
    const [table, clock] = pieces
    expect(table!.object.getWorldPosition(new Vector3()).toArray()).toEqual([2, 0, 1])
    expect(clock!.object.parent).toBe(scene)
  })
})
