import { describe, expect, test } from 'bun:test'
import { designTag, runDesign } from './design'

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

describe('designTag', () => {
  test('reads a kind and an id, any case, with or without one', () => {
    expect(designTag('wall:north')).toEqual({ kind: 'wall', id: 'north' })
    expect(designTag('Door: front')).toEqual({ kind: 'door', id: 'front' })
    expect(designTag('roof')).toEqual({ kind: 'roof', id: '' })
    expect(designTag('room:Living + kitchen')).toEqual({ kind: 'room', id: 'Living + kitchen' })
    expect(designTag('wall lamp')).toBeNull()
    expect(designTag('Walls')).toBeNull()
  })
})

describe('runDesign', async () => {
  const graph = await runDesign({ code: HOUSE })
  const named = (name: string) => graph.objects.find((o) => o.name === name)!

  test('keeps an unchanged geometry as its constructor arguments, an edited one as buffers', () => {
    const body = graph.objects.find(
      (o) => o.type === 'mesh' && o.parent === named('wall:north').id,
    )!
    expect(graph.geometries[body.geometry!]).toMatchObject({
      kind: 'params',
      type: 'BoxGeometry',
      args: [6, 2.7, 0.2, 1, 1, 1],
    })
    expect(graph.geometries[named('crate').geometry!]).toMatchObject({
      kind: 'buffer',
      vertices: 24,
    })
  })

  test('gives world matrices and bounds, and the vertices of what a wall is made of', () => {
    const body = graph.objects.find(
      (o) => o.type === 'mesh' && o.parent === named('wall:north').id,
    )!
    expect(body.bounds).toEqual([-3, 0, -3.1, 3, 2.7, -2.9])
    expect(body.vertices).toBeString()
    expect(named('crate').vertices).toBeUndefined()
  })

  test('records each piece where the design put it, nested or never added', () => {
    expect(
      graph.pieces.map(({ description, size, mount }) => ({ description, size, mount })),
    ).toEqual([
      { description: 'oak table, round, one pedestal', size: [1.2, 0.75, 1.2], mount: 'floor' },
      { description: 'wall clock, brass', size: [0.4, 0.4, 0.05], mount: 'wall-side' },
    ])
    const table = graph.objects[graph.pieces[0]!.object]!
    expect(table.type).toBe('piece')
    expect(table.matrix.slice(12, 15)).toEqual([2, 0, 1])
    const clock = graph.objects[graph.pieces[1]!.object]!
    expect(clock.parent).toBe(-1)
    expect(clock.matrix.slice(12, 15)).toEqual([0, 2, -2.9])
  })

  test('expands instances with their colours, keeps lights and clips, counts the hidden', () => {
    const tiles = graph.objects.filter(
      (o) => o.type === 'mesh' && o.name === '' && o.triangles === 12 && o.bounds![1] === -0.01,
    )
    expect(tiles).toHaveLength(2)
    expect(tiles.map((t) => graph.materials[t.material as number]!.color)).toEqual([
      '#ee0000',
      '#00ee00',
    ])
    expect(graph.objects.find((o) => o.type === 'light')?.light).toEqual({
      kind: 'point',
      color: '#ffe2b8',
      intensity: 2,
      distance: 6,
    })
    expect(named('Door: front').animations).toHaveLength(1)
    expect(graph.skipped).toEqual({ 'hidden objects': 1 })
  })

  test('refuses what a module may not do', async () => {
    await expect(
      runDesign({ code: 'export default function build() { return eval("1") }' }),
    ).rejects.toThrow(/dynamic import, eval/)
    await expect(
      runDesign({
        code: "export default function build({ THREE, piece }) { piece('x', {}); return new THREE.Group() }",
      }),
    ).rejects.toThrow(/size must be/)
  })
})
