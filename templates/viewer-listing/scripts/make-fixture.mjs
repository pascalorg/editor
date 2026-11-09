// Builds the e2e fixtures: a two-floor house GLB shaped like a Pascal bake
// (node.name = pascalId, identity in extras, a door "open" clip, a KTX2 floor
// texture, meshopt compression) and the matching scene response.
//
// Run with `npm run fixture`. Needs KTX-Software's `toktx` on PATH (or set
// TOKTX=/path/to/toktx); the meshopt step downloads @gltf-transform/cli via npx.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// GLTFExporter reads its Blob output through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')

const materials = {
  slab: new MeshStandardMaterial({ name: 'slab', color: '#d9d4cc', roughness: 0.9 }),
  wall: new MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.85 }),
  door: new MeshStandardMaterial({ color: '#8a6a4f', roughness: 0.6 }),
}

const graph = { nodes: {}, rootNodeIds: ['site_fixture'] }

/** A Pascal identity: a named group carrying extras, mirrored as a graph node. */
function identity(id, kind, parent, { label, extras = {}, node = {} } = {}) {
  const group = new Group()
  group.name = id
  group.userData = { pascalId: id, kind, ...(label ? { label } : {}), ...extras }
  if (parent) parent.add(group)
  const parentId = parent?.userData.pascalId ?? null
  graph.nodes[id] = {
    object: 'node',
    id,
    type: kind,
    ...(label ? { name: label } : {}),
    parentId,
    visible: true,
    children: [],
    ...node,
  }
  if (parentId) graph.nodes[parentId].children.push(id)
  return group
}

function box(parent, material, [w, h, d], [x, y, z]) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

function zone(id, level, label, polygon) {
  identity(id, 'zone', level, {
    label,
    extras: { polygon, color: '#7aa2f7' },
    node: { polygon, holes: [] },
  })
}

const site = identity('site_fixture', 'site', null)
const building = identity('building_fixture', 'building', site)

// Ground floor: 8 m x 6 m, a living room (5 x 6 = 30 m²) and a kitchen (3 x 6 = 18 m²).
const ground = identity('level_ground', 'level', building, {
  label: 'Ground floor',
  node: { level: 0 },
})
box(identity('slab_ground', 'slab', ground), materials.slab, [8, 0.2, 6], [0, 0.1, 0])
const walls = [
  ['wall_north', [8, 2.8, 0.15], [0, 1.6, -3]],
  ['wall_east', [0.15, 2.8, 6], [4, 1.6, 0]],
  ['wall_west', [0.15, 2.8, 6], [-4, 1.6, 0]],
  ['wall_south_a', [5, 2.8, 0.15], [-1.5, 1.6, 3]],
  ['wall_south_b', [2, 2.8, 0.15], [3, 1.6, 3]],
]
for (const [id, size, position] of walls) {
  box(identity(id, 'wall', ground), materials.wall, size, position)
}
zone('zone_living', ground, 'Living room', [
  [-4, -3],
  [1, -3],
  [1, 3],
  [-4, 3],
])
zone('zone_kitchen', ground, 'Kitchen', [
  [1, -3],
  [4, -3],
  [4, 3],
  [1, 3],
])

// A front door in the 1 m gap of the south wall, with Pascal's "<id>: open" clip.
const door = identity('door_front', 'door', ground, {
  label: 'Front door',
  extras: { openable: true, clips: ['door_front: open'] },
})
door.position.set(1.5, 0.2, 3)
const hinge = new Group()
hinge.name = 'door_front_leaf'
hinge.position.set(-0.5, 0, 0)
door.add(hinge)
box(hinge, materials.door, [1, 2.1, 0.05], [0.5, 1.05, 0])
const closed = new Quaternion()
const open = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)
const clip = new AnimationClip('door_front: open', 1, [
  new QuaternionKeyframeTrack('door_front_leaf.quaternion', [0, 1], [...closed, ...open]),
])

// First floor: one 48 m² bedroom.
const first = identity('level_first', 'level', building, {
  label: 'First floor',
  node: { level: 1 },
})
first.position.y = 3
box(identity('slab_first', 'slab', first), materials.slab, [8, 0.2, 6], [0, 0.1, 0])
box(identity('wall_first_north', 'wall', first), materials.wall, [8, 1.2, 0.15], [0, 0.8, -3])
zone('zone_bedroom', first, 'Bedroom', [
  [-4, -3],
  [4, -3],
  [4, 3],
  [-4, 3],
])

const glb = await new GLTFExporter().parseAsync(site, { binary: true, animations: [clip] })

/** A 16x16 two-tone checker as PNG bytes. */
function checkerPng(size = 16) {
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++)
      row.push(...((x >> 2) % 2 === (y >> 2) % 2 ? [236, 230, 220] : [196, 186, 170]))
    rows.push(...row)
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
    return Buffer.concat([head, data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const pad4 = (buffer, fill) =>
  Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)])

/** Puts a KTX2 image on the named material as KHR_texture_basisu, like Pascal's bake does. */
function withKtx2BaseColor(glbBytes, materialName, ktx2) {
  const jsonLength = glbBytes.readUInt32LE(12)
  const json = JSON.parse(glbBytes.subarray(20, 20 + jsonLength).toString('utf8'))
  let bin = glbBytes.subarray(28 + jsonLength)
  bin = pad4(bin, 0)
  json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: ktx2.length })
  bin = pad4(Buffer.concat([bin, ktx2]), 0)
  json.buffers[0].byteLength = bin.length
  json.images = [
    ...(json.images ?? []),
    { bufferView: json.bufferViews.length - 1, mimeType: 'image/ktx2' },
  ]
  json.textures = [
    ...(json.textures ?? []),
    { extensions: { KHR_texture_basisu: { source: json.images.length - 1 } } },
  ]
  const material = json.materials.find((entry) => entry.name === materialName)
  material.pbrMetallicRoughness.baseColorTexture = { index: json.textures.length - 1 }
  for (const list of ['extensionsUsed', 'extensionsRequired']) {
    json[list] = [...new Set([...(json[list] ?? []), 'KHR_texture_basisu'])]
  }
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json)), 0x20)
  const header = Buffer.alloc(12)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8)
  const chunkHeader = (length, type) => {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(length, 0)
    head.write(type, 4)
    return head
  }
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 'JSON'),
    jsonChunk,
    chunkHeader(bin.length, 'BIN\0'),
    bin,
  ])
}

const work = mkdtempSync(join(tmpdir(), 'pascal-fixture-'))
try {
  writeFileSync(join(work, 'checker.png'), checkerPng())
  execFileSync(process.env.TOKTX || 'toktx', [
    '--t2',
    '--encode',
    'etc1s',
    '--assign_oetf',
    'srgb',
    join(work, 'checker.ktx2'),
    join(work, 'checker.png'),
  ])
  const raw = join(work, 'raw.glb')
  writeFileSync(
    raw,
    withKtx2BaseColor(Buffer.from(glb), 'slab', readFileSync(join(work, 'checker.ktx2'))),
  )
  execFileSync(
    'npx',
    ['--yes', '@gltf-transform/cli@4', 'meshopt', raw, join(out, 'house.glb'), '--level', 'medium'],
    { stdio: 'inherit' },
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}

const scene = {
  contractVersion: 1,
  project: {
    id: 'fixture-house',
    name: 'Fixture house',
    owner: { displayName: 'Pascal tests', avatarUrl: null },
    coverUrl: null,
  },
  revision: { kind: 'published', version: 3, modelId: 'model_fixture', disclosurePolicyVersion: 1 },
  graph,
  libraryMaterials: [],
  bake: {
    status: 'ready',
    bakeVersion: 3,
    hash: 'fixture',
    // The test rewrites url and expiresAt per run.
    lods: [
      {
        level: 0,
        url: 'https://fixtures.supabase.co/lod0.glb',
        bytes: null,
        triangles: null,
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
    ],
  },
}
writeFileSync(join(out, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`)
