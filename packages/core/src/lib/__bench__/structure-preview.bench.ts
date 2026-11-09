import { type AnyNode, LevelNode, WallNode, ZoneNode } from '../../schema'
import { createLevelStructurePreview, reconcileLevelStructure } from '../structure-kernel'

const levelId = 'level_bench'
const walls = Array.from({ length: 10 }, (_, i) => {
  const x = i * 12
  const ring: [number, number][] = [
    [x, 0],
    [x + 8, 0],
    [x + 8, 4],
    [x, 4],
  ]
  return ring.map((start, j) =>
    WallNode.parse({
      id: `wall_${i}_${j}`,
      parentId: levelId,
      start,
      end: ring[(j + 1) % 4],
      thickness: 0.2,
    }),
  )
}).flat()
const level = LevelNode.parse({ id: levelId, children: walls.map((wall) => wall.id) })
const nodes: Record<string, AnyNode> = Object.fromEntries(
  [level, ...walls].map((node) => [node.id, node]),
)
for (let i = 0; i < 3000; i++) {
  const node = ZoneNode.parse({
    id: `zone_unrelated_${i}`,
    name: 'Unrelated',
    parentId: 'level_other',
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  })
  nodes[node.id] = node
}
let id = 0
for (const patch of reconcileLevelStructure({
  levelId,
  nodes,
  mintId: (kind) => `${kind}_bench_${id++}`,
}).patches) {
  if (patch.op === 'create') nodes[patch.node.id] = patch.node
  else if (patch.op === 'update') nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
  else delete nodes[patch.id]
}
const preview = createLevelStructurePreview(levelId, nodes)
const frames = [0.1, 0.2].map((offset) =>
  walls.map(
    (wall): WallNode =>
      wall.id.startsWith('wall_0_')
        ? {
            ...wall,
            start: [wall.start[0] + (wall.start[0] === 8 ? offset : 0), wall.start[1]],
            end: [wall.end[0] + (wall.end[0] === 8 ? offset : 0), wall.end[1]],
          }
        : wall,
  ),
)
for (let i = 0; i < 100; i++) preview(frames[i % 2]!)
const rounds: number[] = []
for (let round = 0; round < 5; round++) {
  const start = performance.now()
  for (let i = 0; i < 500; i++) preview(frames[i % 2]!)
  rounds.push((performance.now() - start) / 500)
}
console.log(
  JSON.stringify({
    walls: 40,
    unrelatedNodes: 3000,
    warmup: 100,
    ticksPerRound: 500,
    rounds,
    medianMs: [...rounds].sort((a, b) => a - b)[2],
  }),
)
