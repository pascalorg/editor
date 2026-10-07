import { expect, test } from 'bun:test'
import { type AnyNode, LevelNode, type SlabNode, WallNode, ZoneNode } from '../schema'
import { reconcileStructureOnLoad } from './reconcile-structure-on-load'

type P = [number, number]
const rect = (x0: number, z0: number, x1: number, z1: number): P[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
let counter = 0
const wall = (start: P, end: P) =>
  WallNode.parse({
    id: `wall_review_${counter++}`,
    parentId: 'level_p',
    start,
    end,
    thickness: 0.2,
  })
const ringWalls = (ring: P[]) => ring.map((point, i) => wall(point, ring[(i + 1) % ring.length]!))
const zone = (id: string, polygon: P[]) =>
  ZoneNode.parse({
    id,
    name: id,
    polygon,
    parentId: 'level_p',
    spaceRole: 'room',
    enclosureStatus: 'enclosed',
  })
const slabs = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab')
const makeScene = (children: AnyNode[]): Record<string, AnyNode> =>
  Object.fromEntries(
    [LevelNode.parse({ id: 'level_p', children: children.map((n) => n.id) }), ...children].map(
      (n) => [n.id, n],
    ),
  )

function run(cx1: number) {
  const aw = ringWalls(rect(0, 0, 4, 4))
  const A = zone('zone_A', rect(0, 0, 4, 4))
  let nodes = reconcileStructureOnLoad(makeScene([...aw, A])).nodes
  const cw = [wall([4, 0], [cx1, 0]), wall([cx1, 0], [cx1, 4]), wall([cx1, 4], [4, 4])]
  const C = zone('zone_C', rect(4, 0, cx1, 4))
  const lvl = nodes.level_p as LevelNode
  nodes = {
    ...nodes,
    level_p: { ...lvl, children: [...lvl.children, ...cw.map((w) => w.id), C.id] },
  }
  for (const x of [...cw, C]) nodes[x.id] = x
  nodes = reconcileStructureOnLoad(nodes).nodes
  const cw2 = ringWalls(rect(6, 0, cx1 + 2, 4))
  const lv = nodes.level_p as LevelNode
  const retainedId = slabs(nodes).find((plate) => plate.plateRole === 'base')!.id
  const next: Record<string, AnyNode> = { ...nodes }
  for (const w of cw) delete next[w.id]
  next.level_p = {
    ...lv,
    children: [
      ...lv.children.filter((id: string) => !cw.some((w) => w.id === id)),
      ...cw2.map((w) => w.id),
    ],
  }
  for (const w of cw2) next[w.id] = w
  next.zone_C = {
    ...(nodes.zone_C as ZoneNode),
    polygon: rect(6, 0, cx1 + 2, 4),
    boundaryWallIds: [],
  }
  const r = reconcileStructureOnLoad(next).nodes
  expect(r[retainedId]?.type).toBe('slab')
  expect(reconcileStructureOnLoad(r).nodes).toEqual(r)
  expect(slabs(r).filter((p) => p.plateRole === 'base')).toHaveLength(2)
  expect(new Set(slabs(r).map((p) => p.id)).size).toBe(slabs(r).length)
  expect(
    slabs(r)
      .flatMap((p) => p.zoneIds ?? [])
      .sort(),
  ).toEqual(['zone_A', 'zone_C'])
}

test('split retains a smaller original footprint without an ID collision', () => {
  run(12)
})
test('split retains a larger original footprint without an ID collision', () => {
  run(6)
})
