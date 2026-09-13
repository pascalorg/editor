/**
 * Does the derived roof follow its walls? Headless check of `refollowAutoRoof`:
 * load a generated scene into the store, stretch the rear wall out a metre,
 * re-follow, and report what the roof did — the roof node must keep its id
 * and materials, its segments must be re-derived over the new footprint,
 * the walls restamped with their roles.
 *
 *   bun scripts/demo/roof-follow-probe.ts <scene.json>
 */
import { nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import * as nodeDefs from '@pascal-app/nodes'
import { followRoofOf, refollowAutoRoof } from '@pascal-app/plugin-roof'

const g = globalThis as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown }
if (!g.requestAnimationFrame) {
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0)
  g.cancelAnimationFrame = (id: unknown) => clearTimeout(id as never)
}
for (const value of Object.values(nodeDefs)) {
  const def = value as { kind?: string; schema?: unknown }
  if (def && typeof def.kind === 'string' && def.schema && !nodeRegistry.get(def.kind)) registerNode(def as never)
}

const path = process.argv[2] as string
const scene = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>
useScene.setState(scene as never)

type N = Record<string, unknown> & { id: string; type: string; children?: string[] }
const nodes = () => useScene.getState().nodes as unknown as Record<string, N>
const level = Object.values(nodes()).find((n) => n.type === 'level')!
const roofBefore = followRoofOf(nodes() as never, level.id)!
const segsBefore = (roofBefore.children as string[]).filter((id) => nodes()[id]?.type === 'roof-segment')
const depthBefore = segsBefore.map((id) => (nodes()[id] as { depth: number }).depth)
console.log('roof', roofBefore.id, 'segments', segsBefore.length, 'depth', depthBefore.map((d) => d.toFixed(3)).join(','), 'top', (roofBefore as { topMaterialPreset?: string }).topMaterialPreset)

// stretch the rear wall (largest z) out by 1 m, and the two side walls with it
const walls = Object.values(nodes()).filter((n) => n.type === 'wall' && n.parentId === level.id && (n.metadata as { role?: string })?.role === 'exterior')
const zOf = (w: N) => Math.max((w.start as number[])[1]!, (w.end as number[])[1]!)
const rear = walls.reduce((a, b) => (zOf(b) > zOf(a) ? b : a))
const rz = zOf(rear)
const s = useScene.getState()
for (const w of walls) {
  const start = [...(w.start as number[])] as [number, number]
  const end = [...(w.end as number[])] as [number, number]
  if (Math.abs(start[1] - rz) < 1e-6) start[1] += 1
  if (Math.abs(end[1] - rz) < 1e-6) end[1] += 1
  s.updateNode(w.id as never, { start, end } as never)
}
const result = refollowAutoRoof(level.id)
const roofAfter = nodes()[roofBefore.id]!
const segsAfter = (roofAfter.children as string[]).filter((id) => nodes()[id]?.type === 'roof-segment')
const depthAfter = segsAfter.map((id) => (nodes()[id] as { depth: number }).depth)
console.log('after ', roofAfter.id, 'segments', segsAfter.length, 'depth', depthAfter.map((d) => d.toFixed(3)).join(','), 'top', (roofAfter as { topMaterialPreset?: string }).topMaterialPreset)
console.log('same roof node:', roofAfter.id === roofBefore.id, '| old segments gone:', segsBefore.every((id) => !nodes()[id]), '| derived ok:', result?.ok, 'warnings', result?.warnings.length)
console.log('rear wall role:', JSON.stringify((nodes()[rear.id]!.metadata as { roof?: unknown }).roof), '| followedAt:', ((roofAfter.metadata as { autoRoof: { followedAt?: string } }).autoRoof.followedAt ?? 'none').slice(0, 19))
