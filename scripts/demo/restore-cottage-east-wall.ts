/**
 * Undo the accidental east-wall drag saved as scene revision 87 of
 * plancrafters-cottage (2026-09-04 13:17Z): the three exterior walls and the
 * auto roof segment go back to their revision-86 values (32 x 46 house,
 * 7:12 roof) and the auto slab / ceilings the drag spawned are removed.
 * Everything else in the current revision is kept; the scene store keeps
 * every revision, so this is reversible. Needs the dev server on :3002.
 *
 *   bun scripts/demo/restore-cottage-east-wall.ts
 */
import { Database } from 'bun:sqlite'
const API = 'http://localhost:3002'
const db = new Database(process.env.APPDATA + '/Pascal/data/pascal.db', { readonly: true })
const row = db.query("SELECT graph_json FROM scene_revisions WHERE scene_id='plancrafters-cottage' AND version=86").get() as { graph_json: string }
const v86 = JSON.parse(row.graph_json)
const res = await fetch(`${API}/api/scenes/plancrafters-cottage`)
const scene = (await res.json()) as { version: number; graph: any }
const g = scene.graph
const restore = ['wall_rc00000000000005', 'wall_rc0000000000000s', 'wall_rc0000000000001d', 'rseg_7y6ar1bcdt9beui3']
for (const id of restore) g.nodes[id] = v86.nodes[id]
const doomed = Object.values(g.nodes as Record<string, any>)
  .filter((n) => !v86.nodes[n.id] && (n.type === 'slab' || n.type === 'ceiling'))
  .map((n) => n.id)
for (const id of doomed) {
  delete g.nodes[id]
  for (const n of Object.values(g.nodes as Record<string, any>)) {
    if (Array.isArray(n.children)) n.children = n.children.filter((c: string) => c !== id)
  }
}
g.rootNodeIds = g.rootNodeIds.filter((id: string) => g.nodes[id])
console.log('restored', restore, 'removed', doomed)
const put = await fetch(`${API}/api/scenes/plancrafters-cottage`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ graph: g, expectedVersion: scene.version }),
})
console.log(put.status, (await put.text()).slice(0, 200))
