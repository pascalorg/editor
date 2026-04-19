/**
 * Populate the shared scene store with all reference scenes so /scenes
 * shows the full gallery: Villa Azul + 3 templates + Casa del Sol (imported
 * from the Phase 8 store).
 */

import { readFileSync, existsSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3917/mcp'))
const client = new Client({ name: 'gallery', version: '0.0.0' })
await client.connect(transport)

function parse<T>(r: Awaited<ReturnType<Client['callTool']>>): T {
  return JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as T
}

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await client.callTool({ name, arguments: args })
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content).slice(0, 300)}`)
  return parse<T>(r)
}

type Meta = { id: string; name: string; nodeCount: number; url: string }

// 1. Import Casa del Sol (if it exists on disk from Phase 8)
const casaSrcPath = '/tmp/pascal-phase8/scenes/6f87c59c1535.json'
if (existsSync(casaSrcPath)) {
  const raw = JSON.parse(readFileSync(casaSrcPath, 'utf8'))
  const meta = await call<Meta>('save_scene', {
    name: 'Casa del Sol',
    includeCurrentScene: false,
    graph: { nodes: raw.graph?.nodes ?? raw.nodes, rootNodeIds: raw.graph?.rootNodeIds ?? raw.rootNodeIds },
  })
  console.log(`casa-sol imported: ${meta.name} (${meta.nodeCount} nodes) ${meta.url}`)
} else {
  console.log('casa-sol src missing; skipping')
}

// 2. Create 3 template scenes
const templates = ['empty-studio', 'two-bedroom', 'garden-house'] as const
for (const t of templates) {
  // create_from_template applies to the bridge
  await call('create_from_template', { id: t, name: `Template: ${t}` })
  const meta = await call<Meta>('save_scene', { name: `Template: ${t}` })
  console.log(`${t} saved: ${meta.name} (${meta.nodeCount} nodes) ${meta.url}`)
}

// 3. Generate 3 variants of Villa Azul
await call('load_scene', { id: 'a6e7919eacbe' })
const variants = await call<{ variants: Array<{ sceneId?: string; url?: string; description: string }> }>(
  'generate_variants',
  { baseSceneId: 'a6e7919eacbe', count: 3, vary: ['wall-thickness', 'wall-height'], seed: 7, save: true },
)
console.log(`variants generated:`)
for (const v of variants.variants) {
  console.log(`  ${v.description} → ${v.url}`)
}

// 4. List final gallery
const list = await call<{ scenes: Array<{ id: string; name: string; nodeCount: number }> }>(
  'list_scenes',
  {},
)
console.log(`\n=== Gallery: ${list.scenes.length} scenes ===`)
for (const s of list.scenes) {
  console.log(`  http://localhost:3002/scene/${s.id}  -  ${s.name} (${s.nodeCount} nodes)`)
}

await client.close()
