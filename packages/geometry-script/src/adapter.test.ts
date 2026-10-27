import { describe, expect, test } from 'bun:test'
import { runAdapter } from './adapter'
import { compileGeometryScript } from './compile'

/** A design with a window that does not open, its glass opaque, and a spot for a sofa. */
const DESIGN = `export function build({ THREE, scene }) {
  const frame = new THREE.MeshStandardMaterial({ color: '#faf5e8' })
  const pane = new THREE.MeshStandardMaterial({ color: '#34505a' })
  const unit = new THREE.Group()
  unit.position.set(2, 1, 4)
  unit.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.1), frame))
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 0.02), pane)
  glass.position.z = 0.06
  unit.add(glass)
  scene.add(unit)
  const sofa = new THREE.Group()
  sofa.name = 'sofa'
  sofa.position.set(1, 0, 2)
  scene.add(sofa)
}`

/** What an author's adapter does with it: the pane made glass and hung on a sash that opens. */
const ADAPTER = `export default async function adapt({ THREE, run, toModule }) {
  const { scene } = await run()
  const unit = scene.children.find((o) => o.isGroup && o.children.length === 2)
  const [, glass] = unit.children
  glass.material.name = 'glass'
  glass.material.transparent = true
  glass.material.opacity = 0.3
  const sash = new THREE.Group()
  sash.name = 'part:sash'
  sash.position.x = -0.5
  unit.add(sash)
  sash.attach(glass)
  const open = new THREE.AnimationClip('open', 1, [new THREE.NumberKeyframeTrack('part:sash.rotation[y]', [0, 1], [0, -1.2])])
  const window = toModule(unit, { origin: [2, 0.3, 4], mount: 'wall', animations: [open] })
  const sofa = scene.getObjectByName('sofa').getWorldPosition(new THREE.Vector3())
  return {
    levels: [{
      name: 'Ground floor',
      walls: [{ id: 'front', start: [0, 4], end: [6, 4], height: 2.7, thickness: 0.2,
        openings: [{ kind: 'window', along: 2, width: 1.2, height: 1.4, sill: 0.3, type: 'casement', code: window.code }] }],
      items: [{ id: 'sofa', name: 'Sofa', category: 'sofa', piece: 'green-sofa', position: sofa.toArray(), rotation: 180 }],
    }],
    notes: [JSON.stringify(window.size)],
  }
}`

describe('runAdapter', () => {
  test("runs the author's program on the design: its window a module that opens, its glass glass", async () => {
    const { payload } = await runAdapter({ adapter: ADAPTER, design: DESIGN })
    const level = (payload.levels as Array<Record<string, any>>)[0]!
    const code = level.walls[0].openings[0].code as string
    const built = await compileGeometryScript({ code })
    expect(built.mount).toBe('wall')
    expect(built.manifest.animations).toEqual([{ name: 'open', duration: 1 }])
    expect(code).toContain('"name":"glass"')
    // Its bounds in the frame at the origin it was given: the unit as built, the sash included.
    expect(JSON.parse((payload.notes as string[])[0]!)).toEqual([1.2, 1.4, 0.12])
    // A piece add_object makes from words is placed by its id, where the design stood it.
    expect(level.items[0]).toMatchObject({ piece: 'green-sofa', position: [1, 0, 2] })
  })

  test('keeps the modules and design source it carries as text exactly as written', async () => {
    const floor = `import * as THREE from 'three'
export const mount = 'floor'
export default function build({ params }) { return new THREE.Group() }`
    const adapter = `const FLOOR = ${JSON.stringify(floor)}
const quote = /['"]/g
export default async function adapt({ source, run }) {
  // The design marked by a changed copy of its text: its export is the needle.
  const marked = source.replace('export function build({ THREE, scene }) {', \`export function build({ THREE, scene }) {
  scene.userData.marked = true\`)
  const { scene } = await run(marked)
  return { levels: [{ name: 'G', rooms: [{ name: 'Hall', seed: [0, 0], floorCode: FLOOR }] }], notes: [String(scene.userData.marked), 'a "b"'.replace(quote, '')] }
}`
    const { payload } = await runAdapter({ adapter, design: DESIGN })
    expect((payload.levels as Array<Record<string, any>>)[0]!.rooms[0].floorCode).toBe(floor)
    expect(payload.notes).toEqual(['true', 'a b'])
  })

  test('refuses an answer that is no payload, and a module past 48 000 characters', async () => {
    await expect(
      runAdapter({
        adapter: 'export default async function adapt() { return { walls: [] } }',
        design: DESIGN,
      }),
    ).rejects.toThrow('must return the author_scene payload')
    const huge = `export default async function adapt({ THREE, toModule }) {
      const group = new THREE.Group()
      for (let i = 0; i < 1500; i++) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1 + i / 1000, 1, 1))
        mesh.position.x = i
        group.add(mesh)
      }
      return toModule(group)
    }`
    await expect(runAdapter({ adapter: huge, design: DESIGN })).rejects.toThrow(
      /writes a module of \d+ characters; author_scene takes 48000/,
    )
  })
})
