import { beforeEach, describe, expect, test } from 'bun:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { PlannedPiece } from '@pascal-app/core/agent-operations'
import { compileGeometryScript } from '@pascal-app/geometry-script'
import { runAdapter } from '@pascal-app/geometry-script/adapter'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { createPascalMcpServer } from '../server'
import type { GeometryScriptHost, ObjectMakerHost, PieceState } from './add-object'

// author_scene's sources through a real client: the adapter run by the host, edits against the
// stored module and adapter, items naming add_object pieces, and the stored conversion written
// again once a piece lands. add_object's piece path is here too: it feeds those items.

const CHAIR = `import * as THREE from 'three'
export const mount = 'floor'
export default function build({ THREE }) {
  const m = new THREE.MeshStandardMaterial({ color: '#8a6a4a' }); m.name = 'slot_wood'
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), m); b.position.y = 0.45
  const g = new THREE.Group(); g.add(b); return g
}`

/** A one-room house as free three.js: four walls and a spot for a chair. */
const DESIGN = `export function build({ THREE, scene }) {
  const m = new THREE.MeshStandardMaterial({ color: '#eeeeee' })
  const HEIGHT = 2.7
  for (const [name, x, z, w, d] of [['n', 0, -2, 4, 0.2], ['s', 0, 2, 4, 0.2], ['e', 2, 0, 0.2, 4], ['w', -2, 0, 0.2, 4]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, HEIGHT, d), m)
    wall.name = 'wall:' + name
    wall.position.set(x, HEIGHT / 2, z)
    scene.add(wall)
  }
  const spot = new THREE.Group(); spot.name = 'spot:chair'; spot.position.set(1, 0, 1); scene.add(spot)
}`

/** Its adapter: the walls read from the scene, the chair placed by a piece's id. */
const ADAPTER = `export default async function adapt({ THREE, run }) {
  const { scene } = await run()
  const walls = ['n', 's', 'e', 'w'].map((id) => {
    const mesh = scene.getObjectByName('wall:' + id)
    const box = new THREE.Box3().setFromObject(mesh)
    const height = Math.round((box.max.y - box.min.y) * 100) / 100
    const along = box.max.x - box.min.x > box.max.z - box.min.z
    const c = box.getCenter(new THREE.Vector3())
    const start = along ? [box.min.x + 0.1, c.z] : [c.x, box.min.z + 0.1]
    const end = along ? [box.max.x - 0.1, c.z] : [c.x, box.max.z - 0.1]
    return { id, start, end, height, thickness: 0.2,
      openings: id === 's' ? [{ kind: 'door', along: 1.9, width: 0.9, height: 2.1 }] : [] }
  })
  const spot = scene.getObjectByName('spot:chair').getWorldPosition(new THREE.Vector3())
  return {
    levels: [{
      name: 'Ground floor', walls,
      rooms: [{ name: 'Studio', seed: [0, 0], floor: '#c8b08a' }],
      items: [
        { id: 'chair', name: 'Chair', category: 'chair', piece: 'chair', position: spot.toArray() },
        { id: 'sofa', name: 'Sofa', category: 'sofa', piece: 'sofa', position: [-1, 0, 1] },
        { id: 'lamp', name: 'Lamp', category: 'lamp', piece: 'lamp', position: [-1, 0, -1] },
        { id: 'ghost', name: 'Ghost', category: 'chair', piece: 'ghost', position: [0, 0, -1] },
      ],
    }],
  }
}`

describe('author_scene sources (MCP)', () => {
  let client: Client
  const artifacts = new Map<string, Uint8Array>()
  const pieces = new Map<string, PieceState>()
  const started: PlannedPiece[] = []
  const host: GeometryScriptHost = {
    compile: async ({ code, inputs }) => {
      const { glb, ...compiled } = await compileGeometryScript({ code, inputs })
      return { ...compiled, glb: new Uint8Array(glb) }
    },
    storeArtifact: async ({ sha256, bytes }) => {
      artifacts.set(sha256, bytes)
      return sha256
    },
    readArtifact: async ({ sha256 }) => artifacts.get(sha256) ?? null,
    runAdapter: (input) => runAdapter(input),
  }
  const makers: ObjectMakerHost = {
    start: async ({ piece }) => {
      started.push(piece)
    },
    pieces: async ({ ids }) =>
      Object.fromEntries(ids.flatMap((id) => (pieces.has(id) ? [[id, pieces.get(id)!]] : []))),
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: result.isError === true, body: JSON.parse(text) as Record<string, any> }
  }
  const wallHeight = async () => {
    const walls = await call('get_walls', {})
    return JSON.stringify(walls.body).match(/"height":([\d.]+)/)?.[1]
  }

  beforeEach(async () => {
    artifacts.clear()
    started.length = 0
    pieces.clear()
    pieces.set('chair', { status: 'made', code: CHAIR })
    pieces.set('sofa', { status: 'making' })
    pieces.set('lamp', { status: 'failed', error: 'The compiler refused it twice.' })
    const bridge = new SceneBridge()
    bridge.setScene({}, [], { materials: {} })
    const operations = createSceneOperations({ bridge })
    operations.loadDefault()
    operations.designBriefRequired = false
    bridge.setActiveScene({ id: 'scene_test', name: 'Test' } as never)
    const server = createPascalMcpServer({
      operations,
      geometryScripts: host,
      objectMakers: makers,
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  test('runs the adapter on the module, writes its items by piece, and lists what waits', async () => {
    const { isError, body } = await call('author_scene', { module: DESIGN, adapter: ADAPTER })
    expect(isError).toBe(false)
    expect(body.walls).toBe(4)
    expect(body.ids.chair).toBeDefined()
    expect(body.ids.sofa).toBeUndefined()
    expect(body.pending).toEqual([{ id: 'sofa', piece: 'sofa' }])
    expect(body.defects).toEqual([
      { id: 'lamp', code: 'piece_failed', message: 'The compiler refused it twice.' },
      { id: 'ghost', code: 'piece_unknown', message: expect.stringContaining('No piece "ghost"') },
    ])
    expect(body.complete).toBe(false)
    const checks = Object.fromEntries(
      (body.checks as { id: string; passed: boolean; detail: string }[]).map((c) => [c.id, c]),
    )
    expect(checks.pieces).toMatchObject({ passed: false })
    expect(checks.pieces!.detail).toContain('1 of the 4 items naming a piece stand; 1 wait')
    expect(checks.levels!.passed).toBe(true)
    expect(checks.openings!.passed).toBe(true)
    // The module and the adapter are kept as scripts of the scene.
    const texts = [...artifacts.values()].map((bytes) => new TextDecoder().decode(bytes))
    expect(texts).toContain(DESIGN)
    expect(texts).toContain(ADAPTER)
  })

  test("answers an adapter's own error, and a payload its schema refuses, writing nothing", async () => {
    const crash = await call('author_scene', {
      module: DESIGN,
      adapter: 'export default async function adapt() { throw new Error("no wall named n") }',
    })
    expect(crash).toMatchObject({ isError: true, body: { code: 'adapter_failed' } })
    expect(crash.body.error).toContain('no wall named n')
    const invalid = await call('author_scene', {
      module: DESIGN,
      adapter: "export default async function adapt() { return { levels: [{ walls: 'none' }] } }",
    })
    expect(invalid).toMatchObject({ isError: true, body: { code: 'payload_invalid' } })
    expect(invalid.body.issues.map((issue: { path: string }) => issue.path)).toContain(
      'levels.0.name',
    )
    expect((await call('get_walls', {})).body).not.toMatchObject({ walls: [{}] })
  })

  test('revises by edits against the stored module, and refuses an edit it cannot place', async () => {
    await call('author_scene', { module: DESIGN, adapter: ADAPTER })
    expect(await wallHeight()).toBe('2.7')
    const revised = await call('author_scene', {
      replace: true,
      edits: [{ in: 'module', find: 'const HEIGHT = 2.7', replace: 'const HEIGHT = 3.1' }],
    })
    expect(revised.isError).toBe(false)
    expect(await wallHeight()).toBe('3.1')
    expect(
      await call('author_scene', {
        replace: true,
        edits: [{ in: 'adapter', find: 'no such text', replace: '' }],
      }),
    ).toMatchObject({ isError: true, body: { code: 'edit_not_found' } })
    expect(
      await call('author_scene', {
        replace: true,
        edits: [{ in: 'module', find: 'wall', replace: 'w' }],
      }),
    ).toMatchObject({ isError: true, body: { code: 'edit_ambiguous' } })
  })

  test('writes the stored conversion again once a piece lands', async () => {
    await call('author_scene', { module: DESIGN, adapter: ADAPTER })
    pieces.set('sofa', { status: 'made', code: CHAIR.replace('#8a6a4a', '#556b2f') })
    const again = await call('author_scene', { replace: true })
    expect(again.isError).toBe(false)
    expect(again.body.ids.sofa).toBeDefined()
    expect(again.body.pending).toEqual([])
    const items = await call('find_by_type', { type: 'item' })
    expect(JSON.stringify(items.body)).toContain('Sofa')
  })

  test('a level holding no rooms or walls fails the levels check', async () => {
    const { body } = await call('author_scene', {
      payload: {
        levels: [
          {
            name: 'Ground floor',
            walls: [
              { id: 'a', start: [0, 0], end: [4, 0], height: 2.7, thickness: 0.2 },
              { id: 'b', start: [4, 0], end: [4, 4], height: 2.7, thickness: 0.2 },
              { id: 'c', start: [4, 4], end: [0, 4], height: 2.7, thickness: 0.2 },
              { id: 'd', start: [0, 4], end: [0, 0], height: 2.7, thickness: 0.2 },
            ],
            rooms: [{ name: 'Room', seed: [2, 2] }],
          },
          { name: 'Landscape datum', elevation: 3, slabs: [] },
        ],
      },
    })
    const levels = (body.checks as { id: string; passed: boolean; detail: string }[]).find(
      (check) => check.id === 'levels',
    )!
    expect(levels.passed).toBe(false)
    expect(levels.detail).toContain('"Landscape datum" holds no rooms or walls')
  })

  test("add_object's piece starts a maker and answers at once, placed or made only", async () => {
    const placed = await call('add_object', {
      piece: { description: 'A walnut armchair', size: { width: 0.8, height: 0.9, depth: 0.8 } },
      position: [1, 0, 1],
      name: 'Armchair',
      category: 'chair',
      reason: 'Reading corner',
    })
    expect(placed.body).toMatchObject({ status: 'pending', mount: 'floor', size: [0.8, 0.9, 0.8] })
    const made = await call('add_object', {
      piece: {
        description: 'A walnut stool',
        size: { width: 0.4, height: 0.5, depth: 0.4 },
        id: 'stool',
      },
      name: 'Stool',
      category: 'stool',
      reason: 'Kitchen counter',
    })
    expect(made.body).toMatchObject({ piece: 'stool', status: 'pending' })
    expect(made.body.placed).toContain('piece: "stool"')
    expect(started.map((piece) => [piece.description, piece.place?.position ?? null])).toEqual([
      ['A walnut armchair', [1, 0, 1]],
      ['A walnut stool', null],
    ])
    expect(
      await call('add_object', {
        piece: { description: 'x', size: { width: 1, height: 1, depth: 1 } },
        code: CHAIR,
        reason: 'r',
      }),
    ).toMatchObject({ isError: true, body: { code: 'piece_with_code' } })
  })
})
