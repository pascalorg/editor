import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { compileGeometryScript } from '@pascal-app/geometry-script'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { createPascalMcpServer } from '../server'
import type { GeometryScriptHost } from './add-object'

// Layer 2 of 3: author_scene through a real client, with the real compiler behind the host.

const BOX = (w: number, h: number, d: number, color: string) => `import * as THREE from 'three'
export const mount = 'floor'
export default function build({ THREE }) {
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '${color}' }); m.name = 'slot_body'
  const b = new THREE.Mesh(new THREE.BoxGeometry(${w}, ${h}, ${d}), m); b.position.y = ${h / 2}; g.add(b)
  return g
}`

/** A round window's module: a wall-mounted cutout with an open clip's worth of frame. */
const ROUND_WINDOW = `import * as THREE from 'three'
export const mount = 'wall'
export default function build({ THREE }) {
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#dddddd' }); m.name = 'slot_frame'
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24), m); ring.position.y = 0.4; g.add(ring)
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 24)); hole.rotation.x = Math.PI / 2; hole.position.y = 0.4; hole.name = 'cutout'; g.add(hole)
  return g
}`

const payload = {
  levels: [
    {
      name: 'Ground floor',
      walls: [
        {
          id: 'n',
          start: [-2, -2.5],
          end: [2, -2.5],
          height: 2.7,
          thickness: 0.12,
          color: '#8f9e8a',
          colorRight: '#f1ece4',
        },
        {
          id: 'e',
          start: [2, -2.5],
          end: [2, 2.5],
          height: 2.7,
          thickness: 0.12,
          openings: [
            {
              kind: 'window',
              along: 1.2,
              width: 1.4,
              height: 1.3,
              sill: 0.9,
              type: 'casement',
            },
            { kind: 'window', along: 3.8, width: 1, height: 1, sill: 1, code: ROUND_WINDOW },
          ],
        },
        {
          id: 's',
          start: [2, 2.5],
          end: [-2, 2.5],
          height: 2.7,
          thickness: 0.12,
          openings: [
            { kind: 'door', along: 1.2, width: 0.9, height: 2.1, style: 'glass', hinge: 'end' },
          ],
        },
        { id: 'w', start: [-2, 2.5], end: [-2, -2.4], height: 2.7, thickness: 0.12 },
      ],
      rooms: [{ name: 'Bedroom', seed: [0, 0], floor: '#8f9e8a' }],
      items: [
        {
          id: 'skirting',
          name: 'Baseboard',
          category: 'trim',
          code: BOX(3.9, 0.12, 0.015, '#f1ece4'),
          position: [0, 0, 2.4],
          host: 's',
        },
        {
          id: 'bed',
          name: 'Bed',
          category: 'bed',
          code: BOX(1.6, 0.5, 2, '#8a6a4a'),
          position: [0, 0, -1],
        },
        {
          id: 'lamp',
          name: 'Lamp',
          category: 'lamp',
          code: BOX(0.2, 0.4, 0.2, '#eeeeee'),
          position: [1.2, 0.5, -2],
          host: 'bed',
        },
        {
          id: 'bad',
          name: 'Broken',
          category: 'plant',
          code: 'import x from "nowhere"',
          position: [1, 0, 1],
        },
      ],
      lights: [{ position: [1.2, 1, -2], fixture: 'lamp' }],
    },
  ],
  notes: ['The rug was left out.'],
}

describe('author_scene (MCP)', () => {
  let client: Client
  const stored: string[] = []
  const host: GeometryScriptHost = {
    compile: async ({ code }) => {
      const { glb, ...compiled } = await compileGeometryScript({ code })
      return { ...compiled, glb: new Uint8Array(glb) }
    },
    storeArtifact: async ({ sha256, mimeType }) => {
      stored.push(`${mimeType} ${sha256.slice(0, 8)}`)
      return sha256
    },
    readArtifact: async () => null,
  }

  beforeEach(async () => {
    stored.length = 0
    const bridge = new SceneBridge()
    const operations = createSceneOperations({ bridge })
    operations.loadDefault()
    bridge.setActiveScene({ id: 'scene_test', name: 'Test' } as never)
    const server = createPascalMcpServer({ operations, geometryScripts: host })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  test('writes the design, keeps its provenance, and reports the gate', async () => {
    const result = await client.callTool({
      name: 'author_scene',
      arguments: { payload, module: '// the module', adapter: '// the adapter' },
    })
    const report = result.structuredContent as Record<string, unknown> & {
      defects: { id: string; code: string }[]
      defaults: string[]
      ids: Record<string, string>
      verify: { issues: number }
    }
    expect(report.walls).toBe(4)
    expect(report.doors).toBe(1)
    expect(report.windows).toBe(2)
    expect(report.rooms).toBe(1)
    expect(report.items).toBe(3)
    expect(report.lights).toBe(1)
    expect(report.itemsCompiled).toBe(4)
    expect(report.defects).toEqual([
      { id: 'bad', code: 'compile_failed', message: expect.stringContaining('Unsupported import') },
    ])
    expect(report.green).toBe(false)
    expect(report.warnings).toEqual([])
    expect(report.defaults).toContain('door s/0: handle set opposite the hinge (left)')
    expect(report.snapped).toEqual([{ id: 'w', end: 'end', movedM: 0.1 }])
    expect(report.notes).toContain('The rug was left out.')
    // Two artifacts per module (GLB + code): three items and the round window, plus the design's
    // module and the adapter.
    expect(stored.filter((s) => s.startsWith('model/gltf-binary'))).toHaveLength(4)
    expect(stored.filter((s) => s.startsWith('text/javascript'))).toHaveLength(6)
    // The light rides on its fixture through the bridge, not only in the operation's draft.
    const lamp = await client.callTool({ name: 'find_by_type', arguments: { type: 'item' } })
    expect(JSON.stringify(lamp.structuredContent ?? lamp.content)).toContain('Lamp')
    const walls = await client.callTool({ name: 'get_walls', arguments: {} })
    expect(JSON.stringify(walls.structuredContent)).toContain('"height":2.7')
    // What the scene holds: the typed window, the scripted one, the styled door with its handle
    // opposite the hinge, the baseboard on its wall, and one exact material for the sage.
    const node = async (id: string) => {
      const got = await client.callTool({ name: 'get_node', arguments: { id } })
      return JSON.parse((got.content as { text: string }[])[0]!.text).node as Record<string, any>
    }
    expect((await node(report.ids['e/0']!)).windowType).toBe('casement')
    const round = await node(report.ids['e/1']!)
    expect(round.source?.kind).toBe('script')
    expect(round.width).toBeCloseTo(0.88, 2)
    const door = await node(report.ids['s/0']!)
    expect(door.segments).toHaveLength(1)
    expect([door.hingesSide, door.handleSide]).toEqual(['right', 'left'])
    const trim = await node(report.ids.skirting!)
    expect(trim.parentId).toBe(report.ids.s)
    expect(trim.side).toBe('front')
    const north = await node(report.ids.n!)
    expect(north.slots.a).toMatch(/^scene:/)
    expect(north.slots.b).toMatch(/^scene:/)
    expect(north.slots.a).not.toBe(north.slots.b)
    const room = await node(report.ids['room/0/0']!)
    expect(room.floor.finish).toBe(north.slots.a)
  })

  test('refuses to write over a conversion unless told to', async () => {
    await client.callTool({ name: 'author_scene', arguments: { payload } })
    const again = await client.callTool({ name: 'author_scene', arguments: { payload } })
    expect(JSON.stringify(again.structuredContent ?? again.content)).toContain('conversion_exists')
    const replaced = await client.callTool({
      name: 'author_scene',
      arguments: { payload, replace: true },
    })
    expect((replaced.structuredContent as { walls: number }).walls).toBe(4)
  })
})
