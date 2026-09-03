/**
 * Remove every generated sheet and viewport from a scene so "Generate
 * default set" lays the set out again from scratch — the generator is
 * idempotent by sheet number and never touches an existing sheet, so a
 * changed default (scale, layers, a new sheet kind) only reaches a scene
 * whose old sheets are gone. The project record is kept.
 *
 *   bun scripts/demo/reset-sheets.ts [--dry-run]
 */
const API = process.env.PASCAL_API ?? 'http://localhost:3002'
const SCENE_ID = process.env.PASCAL_SCENE ?? 'plancrafters-cottage'
const DRY_RUN = process.argv.includes('--dry-run')

type Node = Record<string, any>

async function main() {
  const res = await fetch(`${API}/api/scenes/${SCENE_ID}`)
  if (!res.ok) throw new Error(`GET scene failed: ${res.status}`)
  const scene = (await res.json()) as { version: number; graph: { nodes: Record<string, Node>; rootNodeIds: string[] } }
  const nodes = scene.graph.nodes
  const doomed = Object.values(nodes).filter(
    (n) => n.type === 'sheets:sheet' || n.type === 'sheets:viewport',
  )
  for (const node of doomed) {
    delete nodes[node.id]
    for (const other of Object.values(nodes)) {
      if (Array.isArray(other.children)) other.children = other.children.filter((c: string) => c !== node.id)
    }
  }
  scene.graph.rootNodeIds = scene.graph.rootNodeIds.filter((id) => nodes[id])
  console.log(`removing ${doomed.length} sheet/viewport nodes (version ${scene.version})`)
  if (DRY_RUN) return
  const put = await fetch(`${API}/api/scenes/${SCENE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ graph: scene.graph, expectedVersion: scene.version }),
  })
  const body = await put.text()
  if (!put.ok) throw new Error(`PUT failed ${put.status}: ${body.slice(0, 500)}`)
  console.log('saved version', JSON.parse(body).version)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
