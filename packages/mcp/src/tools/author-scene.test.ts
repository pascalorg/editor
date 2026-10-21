import { beforeEach, describe, expect, test } from 'bun:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
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

/**
 * A floor of four boards over the bounds of the room's floor, run 0.3 m past them, and one more
 * wholly outside it: Pascal cuts them to the floor.
 */
const BOARDS = `export default function build({ THREE, params }) {
  const xs = params.polygon.map((p) => p[0]), zs = params.polygon.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3, Math.min(...zs) - 0.3, Math.max(...zs) + 0.3]
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#b08060' }); m.name = 'slot_wood'
  const w = (x1 - x0) / 4
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, z1 - z0), m)
    b.position.set(x0 + w * (i + 0.5), params.elevation + 0.005, (z0 + z1) / 2)
    g.add(b)
  }
  return g
}`

/** Rows of 1.2 × 0.2 m boards whose odd rows start 0.4 m in from the floor's west edge. */
const GAPPED = `export default function build({ THREE, params }) {
  const xs = params.polygon.map((p) => p[0]), zs = params.polygon.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#b08060' }); m.name = 'slot_wood'
  for (let row = 0; z0 + row * 0.2 < z1; row++)
    for (let x = x0 + (row % 2 ? 0.4 : 0); x < x1; x += 1.2) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.01, 0.2), m)
      b.position.set(x + 0.6, params.elevation + 0.005, z0 + (row + 0.5) * 0.2)
      g.add(b)
    }
  return g
}`

/** Half-metre tiles from past the start of a wall face to past its end and top, over its openings. */
const TILES = `export default function build({ THREE, params }) {
  const { outline } = params
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff' }); m.name = 'slot_tile'
  const size = 0.5
  for (let x = outline.x0 - 0.25; x < outline.x1 + size; x += size)
    for (let y = outline.y0; y < outline.y1 + size; y += size) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(size - 0.004, size - 0.004, 0.008), m)
      t.position.set(x + size / 2, y + size / 2, 0.004)
      g.add(t)
    }
  return g
}`

/**
 * The triangles' centroids of a compiled GLB, read straight from its chunks: the compiler writes
 * a host's build in the host's frame, with no node transforms to apply.
 */
function glbCentroids(bytes: Uint8Array): [number, number, number][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  const bin = 20 + jsonLength + 8
  expect(
    gltf.nodes.every(
      (node: Record<string, unknown>) =>
        !node.translation && !node.rotation && !node.scale && !node.matrix,
    ),
  ).toBe(true)
  const read = (accessorIndex: number) => {
    const accessor = gltf.accessors[accessorIndex]
    const bufferView = gltf.bufferViews[accessor.bufferView]
    const offset = bin + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const width = { SCALAR: 1, VEC3: 3 }[accessor.type as 'SCALAR' | 'VEC3']
    return Array.from({ length: accessor.count * width }, (_, i) =>
      accessor.componentType === 5126
        ? view.getFloat32(offset + i * 4, true)
        : accessor.componentType === 5125
          ? view.getUint32(offset + i * 4, true)
          : view.getUint16(offset + i * 2, true),
    )
  }
  const centroids: [number, number, number][] = []
  for (const mesh of gltf.meshes)
    for (const primitive of mesh.primitives) {
      const position = read(primitive.attributes.POSITION)
      const count = position.length / 3
      const index =
        primitive.indices === undefined
          ? Array.from({ length: count }, (_, i) => i)
          : read(primitive.indices)
      for (let i = 0; i < index.length; i += 3) {
        const corners = [index[i]!, index[i + 1]!, index[i + 2]!]
        centroids.push(
          [0, 1, 2].map(
            (axis) => corners.reduce((sum, corner) => sum + position[corner * 3 + axis]!, 0) / 3,
          ) as [number, number, number],
        )
      }
    }
  return centroids
}

/** One panel over the whole outline of a wall face. */
const PANEL = `export default function build({ THREE, params }) {
  const { x0, y0, x1, y1 } = params.outline
  const m = new THREE.MeshStandardMaterial({ color: '#c8b89a' }); m.name = 'slot_panel'
  const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.01), m)
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.005)
  const g = new THREE.Group(); g.add(b)
  return g
}`

describe('author_scene (MCP)', () => {
  let client: Client
  let commitAllowed = true
  const stored: string[] = []
  const artifacts = new Map<string, Uint8Array>()
  /** What each build was for, by the hash of its GLB. */
  const builtFor = new Map<string, Record<string, unknown> | undefined>()
  const host: GeometryScriptHost = {
    assertActive: async () => {
      if (!commitAllowed) throw new Error('Invocation stopped before commit')
    },
    compile: async ({ code, inputs }) => {
      const { glb, ...compiled } = await compileGeometryScript({ code, inputs })
      builtFor.set(compiled.sha256, inputs)
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
    commitAllowed = true
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

  test('a stopped invocation never commits its compiled candidate', async () => {
    const before = await client.callTool({ name: 'get_scene', arguments: {} })
    commitAllowed = false
    const result = await client.callTool({ name: 'author_scene', arguments: { payload } })
    expect(result.isError).toBe(true)
    const after = await client.callTool({ name: 'get_scene', arguments: {} })
    expect(after.structuredContent ?? after.content).toEqual(
      before.structuredContent ?? before.content,
    )
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
    // The baseboard's module material is rough 1, not the payload colour's matte 0.9: its own.
    expect(trim.slots.body).toMatch(/^scene:/)
    expect(trim.slots.body).not.toBe(north.slots.b)
  })

  test('authored glass stays glass, a bulb stays lit and a metal keeps its sheen, through the real compiler', async () => {
    const LAMP = `export const mount = 'floor'
export default function build({ THREE }) {
  const g = new THREE.Group()
  const brass = new THREE.MeshStandardMaterial({ color: '#ba9860', metalness: 0.72, roughness: 0.34 }); brass.name = 'slot_brass'
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bfd6d3', transparent: true, opacity: 0.27, roughness: 0.12 }); glass.name = 'glass'
  const bulb = new THREE.MeshStandardMaterial({ color: '#fff4e0', emissive: '#ffd27a', emissiveIntensity: 2 }); bulb.name = 'slot_fff4e0'
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4), brass); stem.position.y = 0.2; g.add(stem)
  const shade = new THREE.Mesh(new THREE.SphereGeometry(0.12), glass); shade.position.y = 0.45; g.add(shade)
  const filament = new THREE.Mesh(new THREE.SphereGeometry(0.03), bulb); filament.position.y = 0.45; g.add(filament)
  return g
}`
    const CASEMENT = `export const mount = 'wall'
export default function build({ THREE }) {
  const g = new THREE.Group()
  const frame = new THREE.MeshStandardMaterial({ color: '#f1ece4' }); frame.name = 'slot_frame'
  const glass = new THREE.MeshPhysicalMaterial({ color: '#d8e4dc', transparent: true, opacity: 0.64, roughness: 0.55 }); glass.name = 'glass'
  const sash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.06), frame); sash.position.y = 0.6; g.add(sash)
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.01), glass); pane.position.y = 0.6; g.add(pane)
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.3)); hole.position.y = 0.6; hole.name = 'cutout'; g.add(hole)
  return g
}`
    const level = payload.levels[0]!
    const design = {
      ...payload,
      levels: [
        {
          ...level,
          walls: level.walls.map((w) =>
            w.id === 'e'
              ? {
                  ...w,
                  openings: [
                    {
                      kind: 'window',
                      along: 2.5,
                      width: 0.9,
                      height: 1.2,
                      sill: 0.9,
                      code: CASEMENT,
                    },
                  ],
                }
              : w,
          ),
          items: [
            { id: 'lamp', name: 'Glass lamp', category: 'lamp', code: LAMP, position: [1, 0, 1] },
          ],
          lights: [{ position: [1, 0.45, 1], fixture: 'lamp', color: '#ffd27a', intensity: 1.5 }],
        },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    expect(response.isError, JSON.stringify(response)).not.toBe(true)
    const report = response.structuredContent as { defects: unknown[]; ids: Record<string, string> }
    expect(report.defects).toEqual([])
    const read = async (id: string) => {
      const got = await client.callTool({ name: 'get_node', arguments: { id } })
      return JSON.parse((got.content as { text: string }[])[0]!.text) as {
        node: Record<string, any>
        materials?: Record<
          string,
          { name: string; material: { properties: Record<string, unknown> } }
        >
      }
    }
    const lamp = await read(report.ids.lamp!)
    expect(lamp.node.slots.glass).toBe('library:preset-glass')
    // The bulb keeps the module's emissive material: no override, and its hint and light survive.
    expect(lamp.node.slots.fff4e0).toBeUndefined()
    expect(lamp.node.source.manifest.slots).toContainEqual(
      expect.objectContaining({ id: 'fff4e0', emissive: true }),
    )
    expect(lamp.node.asset.interactive.effects).toEqual([
      expect.objectContaining({ kind: 'light', color: '#ffd27a' }),
    ])
    const brass = lamp.materials![lamp.node.slots.brass.slice('scene:'.length)]!
    expect(brass.material.properties).toMatchObject({ color: '#ba9860', metalness: 0.72 })
    expect(brass.material.properties.roughness).toBeCloseTo(0.34, 6)
    const casement = await read(report.ids['e/0']!)
    expect(casement.node.slots.glass).toBe('library:preset-glass')
    expect(casement.node.slots.frame).toMatch(/^scene:/)
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
      warnings: { code: string }[]
      ids: Record<string, string>
      payload?: unknown
    }
    expect(report.defects).toEqual([])
    expect(report.floorScripts).toBe(1)
    expect(report.warnings.filter((w) => w.code === 'finish_gaps')).toEqual([])
    const read = async (id: string) => {
      const got = await client.callTool({ name: 'get_node', arguments: { id } })
      return JSON.parse((got.content as { text: string }[])[0]!.text).node as Record<string, any>
    }
    const room = await read(report.ids['room/0/0']!)
    expect(room.floor.finish).toMatch(/^scene:/)
    expect(room.floor.script.language).toBe('three')
    expect(room.floor.script.manifest.slots.map((s: { id: string }) => s.id)).toEqual(['wood'])
    expect(room.floor.script.inputs).toEqual(expect.any(String))
    // The boards, laid past the floor, are cut to the room inside the walls' faces:
    // 4 m − 0.12 m by 5 m − 0.12 m.
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

  test('a floor module that leaves a strip bare is written, with a warning that says how much and where', async () => {
    const level = payload.levels[0]!
    const design = {
      ...payload,
      levels: [
        { ...level, items: [], lights: [], rooms: [{ ...level.rooms[0]!, floorCode: GAPPED }] },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    const report = response.structuredContent as {
      floorScripts: number
      defects: unknown[]
      warnings: { id: string; code: string; message: string }[]
      ids: Record<string, string>
    }
    expect(report.defects).toEqual([])
    expect(report.floorScripts).toBe(1)
    const got = await client.callTool({
      name: 'get_node',
      arguments: { id: report.ids['room/0/0']! },
    })
    const script = JSON.parse((got.content as { text: string }[])[0]!.text).node.floor.script
    const { polygon } = builtFor.get(script.artifact) as { polygon: [number, number][] }
    const xs = polygon.map(([x]) => x)
    const zs = polygon.map(([, z]) => z)
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    // Each odd row leaves 0.4 m of its width bare at the west edge.
    let bare = 0
    for (let row = 1; z0 + row * 0.2 < z1; row += 2)
      bare += 0.4 * Math.min(0.2, z1 - (z0 + row * 0.2))
    const coverage = Math.round((1 - bare / ((x1 - x0) * (z1 - z0))) * 100) / 100
    expect(script.manifest.coverage).toBe(coverage)
    expect(report.warnings.filter((w) => w.code === 'finish_gaps')).toEqual([
      {
        id: 'room/0/0',
        code: 'finish_gaps',
        message: expect.stringContaining(
          `covers ${Math.round(coverage * 100)}% of its floor: uncovered along the west edge (0.4 × `,
        ),
      },
    ])
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

  test("writes a wall's face module and a room's wallCode on its faces, readable with get_source", async () => {
    const level = payload.levels[0]!
    const design = {
      ...payload,
      levels: [
        {
          ...level,
          items: [],
          lights: [],
          walls: level.walls.map((w) => (w.id === 'e' ? { ...w, faceLeft: { code: TILES } } : w)),
          rooms: [{ ...level.rooms[0]!, wallCode: PANEL, wallToHeight: 1.2 }],
        },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    const report = response.structuredContent as {
      faceScripts: number
      defects: unknown[]
      ids: Record<string, string>
    }
    expect(report.defects).toEqual([])
    expect(report.faceScripts).toBe(4)
    const read = async (id: string) => {
      const got = await client.callTool({ name: 'get_node', arguments: { id } })
      return JSON.parse((got.content as { text: string }[])[0]!.text).node as Record<string, any>
    }
    // The tiles, laid past the east wall's room face and over its windows, are cut to the face
    // between its mitred ends and under its top, and to each window's rectangle.
    const east = await read(report.ids.e!)
    const tiles = east.finishScripts.a
    expect(east.finishScripts.b).toBeUndefined()
    expect(tiles.language).toBe('three')
    expect(tiles.toHeight).toBeUndefined()
    expect(tiles.manifest.slots.map((s: { id: string }) => s.id)).toEqual(['tile'])
    const face = builtFor.get(tiles.artifact) as {
      outline: { x0: number; y0: number; x1: number; y1: number }
      holes: { x0: number; y0: number; x1: number; y1: number }[]
    }
    const { min, max } = tiles.manifest.bounds
    expect(min[0]).toBeCloseTo(face.outline.x0, 4)
    expect(max[0]).toBeCloseTo(face.outline.x1, 4)
    // The first row stands half a joint (2 mm) off the floor; the top row is cut at the top.
    expect(min[1]).toBeCloseTo(0.002, 4)
    expect(max[1]).toBeCloseTo(2.7, 4)
    expect(max[2] - min[2]).toBeCloseTo(0.008, 3)
    expect(face.holes).toHaveLength(2)
    const inWindow = glbCentroids(artifacts.get(tiles.artifact)!).filter(([x, y]) =>
      face.holes.some(
        (h) => x > h.x0 + 1e-4 && x < h.x1 - 1e-4 && y > h.y0 + 1e-4 && y < h.y1 - 1e-4,
      ),
    )
    expect(inWindow).toEqual([])
    // The room's other walls are panelled to 1.2 m on the face it looks into.
    for (const id of ['n', 's', 'w']) {
      const wall = await read(report.ids[id]!)
      expect(wall.finishScripts.a.toHeight).toBe(1.2)
      expect(wall.finishScripts.a.manifest.bounds.max[1]).toBeCloseTo(1.2, 3)
      expect(wall.finishScripts.b).toBeUndefined()
    }
    const source = await client.callTool({
      name: 'get_source',
      arguments: { nodeId: report.ids.e!, face: 'a' },
    })
    expect(source.structuredContent).toMatchObject({ type: 'wall', language: 'three', code: TILES })
  })

  test('a face module that fails is a defect and the face keeps its paint', async () => {
    const level = payload.levels[0]!
    const design = {
      ...payload,
      levels: [
        {
          ...level,
          items: [],
          lights: [],
          walls: level.walls.map((w) =>
            w.id === 'n' ? { ...w, faceLeft: { code: 'import x from "nowhere"' } } : w,
          ),
        },
      ],
    }
    const response = await client.callTool({ name: 'author_scene', arguments: { payload: design } })
    const report = response.structuredContent as {
      faceScripts: number
      defects: { id: string; code: string; message: string }[]
      ids: Record<string, string>
    }
    expect(report.faceScripts).toBe(0)
    expect(report.defects).toEqual([
      {
        id: 'n/a',
        code: 'face_script_failed',
        message: expect.stringContaining('Unsupported import'),
      },
    ])
    const got = await client.callTool({ name: 'get_node', arguments: { id: report.ids.n! } })
    const north = JSON.parse((got.content as { text: string }[])[0]!.text).node
    expect(north.slots.a).toMatch(/^scene:/)
    expect(north.finishScripts).toBeUndefined()
  })
})
