/**
 * Villa Azul — build the scene via MCP HTTP, save via save_scene.
 * Usage:
 *   PASCAL_DATA_DIR=/tmp/pascal-villa bun run packages/mcp/test-reports/villa-azul/build.ts
 * Assumes MCP HTTP server is listening on :3917.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = 'http://localhost:3917/mcp'

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL))
const client = new Client({ name: 'villa-azul-build', version: '0.0.0' })
await client.connect(transport)

function structured<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const text = (result.content as Array<{ text: string }>)[0]!.text
  return JSON.parse(text) as T
}

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await client.callTool({ name, arguments: args })
  if (r.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(r.content).slice(0, 400)}`)
  }
  return structured<T>(r)
}

type Node = { id: string; type: string; [k: string]: unknown }
type Scene = { nodes: Record<string, Node>; rootNodeIds: string[] }
type Meta = {
  id: string
  name: string
  version: number
  nodeCount: number
  sizeBytes: number
  url: string
}
type WallId = string & { readonly _brand: 'wall' }

console.log('---- Villa Azul build ----')

// Step 1 — Discover the default site/building/level
const scene0 = await call<Scene>('get_scene')
const buildingId = Object.values(scene0.nodes).find((n) => n.type === 'building')!.id
const levelId = Object.values(scene0.nodes).find((n) => n.type === 'level')!.id
console.log(`01 discover  buildingId=${buildingId} levelId=${levelId}`)

// Step 2 — Perimeter walls of the main volume (15 × 10, offset so pool sits east)
// Building occupies x ∈ [−10, 5], z ∈ [−5, 5]. Pool sits east of building.
const perim = [
  { label: 'south', start: [-10, 5], end: [5, 5] },
  { label: 'north', start: [-10, -5], end: [5, -5] },
  { label: 'west', start: [-10, -5], end: [-10, 5] },
  { label: 'east', start: [5, -5], end: [5, 5] },
]
const perimWallIds: Record<string, WallId> = {}
for (const { label, start, end } of perim) {
  const r = await call<{ wallId: WallId }>('create_wall', {
    levelId,
    start,
    end,
    thickness: 0.22,
    height: 2.8,
  })
  perimWallIds[label] = r.wallId
}
console.log(`02 perimeter ${Object.values(perimWallIds).join(', ')}`)

// Step 3 — Interior partitions
// Layout from west to east:
//   x=-10..-7  → Master bedroom (z=-5..1)
//   x=-10..-7  → Master bath (z=1..5)
//   x=-7..-4   → Bedroom 2 (z=-5..-1); Bath shared (z=-1..1); Bedroom 3 (z=1..5)
//   x=-4..2    → Living/dining (z=-5..2); Kitchen (z=2..5)
//   x=2..5     → Entry hall (z=-5..0); Corridor (z=0..5)
// Interior partitions (start/end in level plane):
const interior = [
  { label: 'master-east', start: [-7, -5], end: [-7, 5] }, // separates master from center
  { label: 'master-bath', start: [-10, 1], end: [-7, 1] }, // splits master bedroom from master bath
  { label: 'bed2-north', start: [-7, -1], end: [-4, -1] }, // separates bed2 from bath shared
  { label: 'bed3-south', start: [-7, 1], end: [-4, 1] }, // separates bath shared from bed3
  { label: 'center-east', start: [-4, -5], end: [-4, 5] }, // separates bedrooms from living
  { label: 'kitchen-south', start: [-4, 2], end: [2, 2] }, // splits living from kitchen
  { label: 'hall-west', start: [2, -5], end: [2, 5] }, // separates hall/corridor from living
  { label: 'hall-south', start: [2, 0], end: [5, 0] }, // splits entry hall from corridor
]
const interiorWallIds: Record<string, WallId> = {}
for (const { label, start, end } of interior) {
  const r = await call<{ wallId: WallId }>('create_wall', {
    levelId,
    start,
    end,
    thickness: 0.12,
    height: 2.8,
  })
  interiorWallIds[label] = r.wallId
}
console.log(`03 interior  ${Object.keys(interiorWallIds).length} walls created`)

// Step 4 — Zones
const zones = [
  {
    label: 'Master bedroom',
    polygon: [
      [-10, -5],
      [-7, -5],
      [-7, 1],
      [-10, 1],
    ],
  },
  {
    label: 'Master bath',
    polygon: [
      [-10, 1],
      [-7, 1],
      [-7, 5],
      [-10, 5],
    ],
  },
  {
    label: 'Bedroom 2',
    polygon: [
      [-7, -5],
      [-4, -5],
      [-4, -1],
      [-7, -1],
    ],
  },
  {
    label: 'Shared bath',
    polygon: [
      [-7, -1],
      [-4, -1],
      [-4, 1],
      [-7, 1],
    ],
  },
  {
    label: 'Bedroom 3',
    polygon: [
      [-7, 1],
      [-4, 1],
      [-4, 5],
      [-7, 5],
    ],
  },
  {
    label: 'Living dining',
    polygon: [
      [-4, -5],
      [2, -5],
      [2, 2],
      [-4, 2],
    ],
  },
  {
    label: 'Kitchen',
    polygon: [
      [-4, 2],
      [2, 2],
      [2, 5],
      [-4, 5],
    ],
  },
  {
    label: 'Entry hall',
    polygon: [
      [2, -5],
      [5, -5],
      [5, 0],
      [2, 0],
    ],
  },
  {
    label: 'Corridor',
    polygon: [
      [2, 0],
      [5, 0],
      [5, 5],
      [2, 5],
    ],
  },
]
const zoneIds: string[] = []
for (const { label, polygon } of zones) {
  const r = await call<{ zoneId: string }>('set_zone', { levelId, polygon, label })
  zoneIds.push(r.zoneId)
}
console.log(`04 zones     ${zoneIds.length} zones`)

// Step 5 — Doors
const doors = [
  { wallId: perimWallIds.south, pos: 0.9, w: 1.0, h: 2.1, label: 'front-door' },
  { wallId: perimWallIds.north, pos: 0.75, w: 0.9, h: 2.1, label: 'kitchen-back' },
  { wallId: perimWallIds.south, pos: 0.4, w: 2.4, h: 2.2, label: 'living-patio' },
  { wallId: perimWallIds.east, pos: 0.75, w: 1.8, h: 2.2, label: 'pool-slider' },
  { wallId: interiorWallIds['master-east']!, pos: 0.25, w: 0.8, h: 2.05, label: 'master-door' },
  { wallId: interiorWallIds['master-bath']!, pos: 0.5, w: 0.7, h: 2.0, label: 'master-bath-door' },
  { wallId: interiorWallIds['center-east']!, pos: 0.12, w: 0.8, h: 2.05, label: 'bed2-door' },
  { wallId: interiorWallIds['center-east']!, pos: 0.88, w: 0.8, h: 2.05, label: 'bed3-door' },
  { wallId: interiorWallIds['bed2-north']!, pos: 0.5, w: 0.7, h: 2.0, label: 'shared-bath-door' },
  { wallId: interiorWallIds['hall-west']!, pos: 0.9, w: 0.9, h: 2.05, label: 'hall-to-living' },
]
let doorOk = 0
let doorFail = 0
for (const d of doors) {
  try {
    await call<{ openingId: string }>('cut_opening', {
      wallId: d.wallId,
      type: 'door',
      position: d.pos,
      width: d.w,
      height: d.h,
    })
    doorOk++
  } catch (err) {
    doorFail++
    console.log(`   door fail ${d.label}: ${(err as Error).message.slice(0, 80)}`)
  }
}
console.log(`05 doors     ${doorOk}/${doors.length} ok (${doorFail} failed)`)

// Step 6 — Windows
const windows = [
  { wallId: perimWallIds.south, pos: 0.15, w: 1.4, h: 1.5, label: 'master-s-window' },
  { wallId: perimWallIds.south, pos: 0.65, w: 2.0, h: 1.5, label: 'living-s-window' },
  { wallId: perimWallIds.north, pos: 0.15, w: 1.0, h: 1.4, label: 'bed3-n-window' },
  { wallId: perimWallIds.north, pos: 0.55, w: 1.4, h: 1.4, label: 'kitchen-n-window' },
  { wallId: perimWallIds.west, pos: 0.2, w: 1.0, h: 1.4, label: 'master-w-window' },
  { wallId: perimWallIds.west, pos: 0.75, w: 0.8, h: 0.9, label: 'master-bath-w-window' },
  { wallId: perimWallIds.east, pos: 0.15, w: 1.0, h: 1.4, label: 'entry-e-window' },
  { wallId: perimWallIds.east, pos: 0.4, w: 0.9, h: 1.4, label: 'corridor-e-window' },
  { wallId: interiorWallIds['master-bath']!, pos: 0.2, w: 0.6, h: 0.6, label: 'bath-transom' },
  { wallId: perimWallIds.north, pos: 0.35, w: 0.8, h: 0.7, label: 'shared-bath-nw' },
  { wallId: perimWallIds.south, pos: 0.22, w: 1.2, h: 1.5, label: 'bed-corridor-window' },
  { wallId: perimWallIds.south, pos: 0.55, w: 1.4, h: 1.5, label: 'living-s-2' },
]
let winOk = 0
let winFail = 0
for (const w of windows) {
  try {
    await call<{ openingId: string }>('cut_opening', {
      wallId: w.wallId,
      type: 'window',
      position: w.pos,
      width: w.w,
      height: w.h,
    })
    winOk++
  } catch (_err) {
    winFail++
  }
}
console.log(`06 windows   ${winOk}/${windows.length} ok (${winFail} failed)`)

// Step 7 — Pool zone (east of house) + pool basin slab
await call<{ zoneId: string }>('set_zone', {
  levelId,
  polygon: [
    [7, -2],
    [15, -2],
    [15, 2],
    [7, 2],
  ],
  label: 'Pool',
  properties: { kind: 'pool', depthM: 2.0, finish: 'tile' },
})
console.log('07 pool zone created')

const slabOpId = 'slab_azul_pool'
await call<{ appliedOps: number; createdIds: string[] }>('apply_patch', {
  patches: [
    {
      op: 'create',
      node: {
        object: 'node',
        id: slabOpId,
        type: 'slab',
        parentId: null,
        visible: true,
        metadata: { kind: 'pool-basin', depthM: 2.0 },
        polygon: [
          [7, -2],
          [15, -2],
          [15, 2],
          [7, 2],
        ],
        holes: [],
        holeMetadata: [],
        elevation: -2.0,
        autoFromWalls: false,
      },
      parentId: levelId,
    },
  ],
})
console.log('07b pool basin slab at elevation -2.0m')

// Step 8 — Outdoor kitchen zone
await call<{ zoneId: string }>('set_zone', {
  levelId,
  polygon: [
    [7, 3],
    [12, 3],
    [12, 6],
    [7, 6],
  ],
  label: 'Outdoor kitchen',
  properties: { kind: 'outdoor-kitchen' },
})

// Step 9 — Driveway zone
await call<{ zoneId: string }>('set_zone', {
  levelId,
  polygon: [
    [-12.5, 5.5],
    [-6, 5.5],
    [-6, 10],
    [-12.5, 10],
  ],
  label: 'Driveway',
  properties: { kind: 'driveway', surface: 'concrete' },
})

// Step 10 — Back patio zone
await call<{ zoneId: string }>('set_zone', {
  levelId,
  polygon: [
    [-5, 5.5],
    [5, 5.5],
    [5, 7.5],
    [-5, 7.5],
  ],
  label: 'Back patio',
  properties: { kind: 'patio' },
})

console.log('08 exterior zones added (outdoor kitchen, driveway, back patio)')

// Step 11 — Rail-style fence around lot perimeter (25 × 20, corners ±12.5, ±10)
const fences = [
  { start: [-12.5, 10], end: [-1, 10] }, // north-west
  { start: [1, 10], end: [12.5, 10] }, // north-east (gap at entrance)
  { start: [12.5, 10], end: [12.5, -10] }, // east
  { start: [12.5, -10], end: [-12.5, -10] }, // south
  { start: [-12.5, -10], end: [-12.5, 10] }, // west
]
const fencePatches = fences.map(({ start, end }) => ({
  op: 'create' as const,
  node: {
    type: 'fence' as const,
    start,
    end,
    height: 1.5,
    style: 'rail' as const,
    thickness: 0.08,
    baseHeight: 0.1,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.01,
    baseStyle: 'grounded' as const,
    color: '#ffffff',
  },
  parentId: levelId,
}))
await call<{ appliedOps: number; createdIds: string[] }>('apply_patch', {
  patches: fencePatches,
})
console.log(`09 fences    ${fences.length} rail segments (gap at south entrance)`)

// Step 12 — Validate
const validate = await call<{ valid: boolean; errors: unknown[] }>('validate_scene')
console.log(`10 validate  valid=${validate.valid} errors=${validate.errors.length}`)

// Step 13 — Save
const meta = await call<Meta>('save_scene', { name: 'Villa Azul' })
console.log(`11 save      id=${meta.id} version=${meta.version} nodes=${meta.nodeCount}`)
console.log(`   url:     ${meta.url}`)
console.log(`   sizeBytes: ${meta.sizeBytes}`)

// Step 14 — Emit final counts + sceneId for verifier agents
const scene = await call<Scene>('get_scene')
const typeCounts = new Map<string, number>()
for (const n of Object.values(scene.nodes)) {
  typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1)
}
const summary = {
  sceneId: meta.id,
  version: meta.version,
  nodeCount: meta.nodeCount,
  sizeBytes: meta.sizeBytes,
  url: `http://localhost:3002${meta.url}`,
  typeCounts: Object.fromEntries(typeCounts),
  validation: { valid: validate.valid, errors: validate.errors.length },
  doorResults: { ok: doorOk, fail: doorFail },
  windowResults: { ok: winOk, fail: winFail },
}
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify(summary, null, 2))

// Write the summary to a known location so verifier agents can read it
const summaryPath = 'packages/mcp/test-reports/villa-azul/build-summary.json'
await Bun.write(summaryPath, JSON.stringify(summary, null, 2))
console.log(`\nwrote ${summaryPath}`)

await client.close()
