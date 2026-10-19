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
            {
              kind: 'window',
              along: 3.8,
              width: 1,
              height: 1,
              sill: 1,
              type: 'casement',
              code: ROUND_WINDOW,
              frameColor: '#f1ece4',
            },
          ],
        },
        {
          id: 's',
          start: [2, 2.5],
          end: [-2, 2.5],
          height: 2.7,
          thickness: 0.12,
          openings: [
            {
              kind: 'door',
              along: 1.2,
              width: 0.9,
              height: 2.1,
              style: 'glass',
              hinge: 'end',
              color: '#8f9e8a',
              frameColor: '#f1ece4',
            },
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

/** A floor of four boards across the bounds of the room's floor, at its top. */
const BOARDS = `export default function build({ THREE, params }) {
  const xs = params.polygon.map((p) => p[0]), zs = params.polygon.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#b08060' }); m.name = 'slot_wood'
  const w = (x1 - x0) / 4
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, z1 - z0), m)
    b.position.set(x0 + w * (i + 0.5), params.elevation + 0.005, (z0 + z1) / 2)
    g.add(b)
  }
  return g
}`

describe('author_scene (MCP)', () => {
  let client: Client
  const stored: string[] = []
  const artifacts = new Map<string, Uint8Array>()
  const host: GeometryScriptHost = {
    compile: async ({ code, inputs }) => {
      const { glb, ...compiled } = await compileGeometryScript({ code, inputs })
      return { ...compiled, glb: new Uint8Array(glb) }
    },
    storeArtifact: async ({ sha256, mimeType, bytes }) => {
      stored.push(`${mimeType} ${sha256.slice(0, 8)}`)
      artifacts.set(sha256, bytes)
      return sha256
    },
    readArtifact: async ({ sha256 }) => artifacts.get(sha256) ?? null,
  }

  beforeEach(async () => {
    stored.length = 0
    const bridge = new SceneBridge()
    bridge.setScene({}, [], { materials: {} })
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
    expect(round.windowType).toBe('casement')
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
    expect(door.slots.panel).toBe(north.slots.a)
    expect(door.slots.frame).toBe(north.slots.b)
    expect(round.slots.frame).toBe(north.slots.b)
    expect(trim.slots.body).toBe(north.slots.b)
  })

  test('compiles a 60 mm ceiling point and persists its room ceiling host and light effect', async () => {
    const design = {
      ...payload,
      levels: [
        {
          ...payload.levels[0],
          items: [],
          lights: [{ position: [0, 2.4, 0], color: '#ffeedd', intensity: 2 }],
        },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    expect(response.isError, JSON.stringify(response)).not.toBe(true)
    const report = response.structuredContent as {
      items: number
      lights: number
      itemsCompiled: number
      defects: unknown[]
      defaults: string[]
      ids: Record<string, string>
    }
    expect(report.defects).toEqual([])
    expect(report.items).toBe(1)
    expect(report.lights).toBe(1)
    expect(report.itemsCompiled).toBe(2)
    expect(report.defaults).toContain(
      'light at [0, 2.4, 0] has no fixture: a ceiling point in Bedroom',
    )
    const read = async (id: string) => {
      const got = await client.callTool({ name: 'get_node', arguments: { id } })
      return JSON.parse((got.content as { text: string }[])[0]!.text).node as Record<string, any>
    }
    const point = await read(report.ids['light/0/0']!)
    const ceiling = await read(point.parentId)
    expect(ceiling.type).toBe('ceiling')
    expect(ceiling.zoneId).toBe(report.ids['room/0/0'])
    expect(ceiling.children).toContain(point.id)
    expect(point.source.kind).toBe('script')
    expect(point.asset.category).toBe('light')
    expect(point.asset.attachTo).toBe('ceiling')
    expect(point.asset.dimensions[0]).toBeCloseTo(0.06, 6)
    expect(point.asset.dimensions[1]).toBeCloseTo(0.008, 6)
    expect(point.asset.dimensions[2]).toBeCloseTo(0.06, 6)
    expect(point.position).toEqual([0, 0, 0])
    expect(point.asset.interactive.effects).toEqual([
      {
        kind: 'light',
        color: '#ffeedd',
        intensityRange: [0, 2],
        offset: [0, expect.any(Number), 0],
      },
    ])
    expect(stored.filter((s) => s.startsWith('model/gltf-binary'))).toHaveLength(2)
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

  test("writes a wall's skirting and a room's floor script, readable with get_source", async () => {
    const level = payload.levels[0]!
    const design = {
      ...payload,
      levels: [
        {
          ...level,
          items: [],
          lights: [],
          walls: level.walls.map((w) =>
            w.id === 'n' ? { ...w, skirting: { color: '#f1ece4' } } : w,
          ),
          rooms: [{ ...level.rooms[0]!, floorCode: BOARDS }],
        },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    const report = response.structuredContent as {
      floorScripts: number
      defects: unknown[]
      ids: Record<string, string>
      payload?: unknown
    }
    expect(report.defects).toEqual([])
    expect(report.floorScripts).toBe(1)
    const read = async (id: string) => {
      const got = await client.callTool({ name: 'get_node', arguments: { id } })
      return JSON.parse((got.content as { text: string }[])[0]!.text).node as Record<string, any>
    }
    const room = await read(report.ids['room/0/0']!)
    expect(room.floor.finish).toMatch(/^scene:/)
    expect(room.floor.script.language).toBe('three')
    expect(room.floor.script.manifest.slots.map((s: { id: string }) => s.id)).toEqual(['wood'])
    expect(room.floor.script.inputs).toEqual(expect.any(String))
    // The boards span the room inside the walls' faces: 4 m − 0.12 m by 5 m − 0.12 m.
    const { min, max } = room.floor.script.manifest.bounds
    expect(max[0] - min[0]).toBeCloseTo(3.88, 2)
    expect(max[2] - min[2]).toBeCloseTo(4.88, 2)
    const north = await read(report.ids.n!)
    expect(north.skirting).toMatchObject({ enabled: true, sides: 'a', height: 0.1, proud: 0.012 })
    expect(north.slots.aSkirting).toBe(north.slots.b)
    const source = await client.callTool({
      name: 'get_source',
      arguments: { nodeId: report.ids['room/0/0']! },
    })
    expect(source.structuredContent).toMatchObject({
      type: 'zone',
      language: 'three',
      code: BOARDS,
    })
  })

  test('a floor script that fails is a defect and the room keeps its floor finish', async () => {
    const level = payload.levels[0]!
    const design = {
      ...payload,
      levels: [
        {
          ...level,
          items: [],
          lights: [],
          rooms: [{ ...level.rooms[0]!, floorCode: 'import x from "nowhere"' }],
        },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    const report = response.structuredContent as {
      floorScripts: number
      defects: { id: string; code: string; message: string }[]
      ids: Record<string, string>
    }
    expect(report.floorScripts).toBe(0)
    expect(report.defects).toEqual([
      {
        id: 'room/0/0',
        code: 'floor_script_failed',
        message: expect.stringContaining('Unsupported import'),
      },
    ])
    const got = await client.callTool({
      name: 'get_node',
      arguments: { id: report.ids['room/0/0']! },
    })
    const room = JSON.parse((got.content as { text: string }[])[0]!.text).node
    expect(room.floor.finish).toMatch(/^scene:/)
    expect(room.floor.script).toBeUndefined()
  })
})
