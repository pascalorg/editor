import type { WallNode } from '../schema'
import { SeparatorNode } from '../schema/nodes/separator'
import { omitUndefined } from '../utils/omit-undefined'
import { sampleWallPointsForRoomDetection } from './room-graph'
import type { NodePatch, SceneNodes } from './structure-kernel'

export function absorbWallSeparators(nodes: SceneNodes, levelId: string, mintId: () => string) {
  const walls = Object.values(nodes).filter(
    (n): n is WallNode => n.type === 'wall' && n.parentId === levelId,
  )
  const lines = walls.flatMap((wall) => {
    const points = sampleWallPointsForRoomDetection(wall)
    return points.slice(1).map((end, i) => [points[i]!, end] as const)
  })
  const patches: NodePatch[] = []
  const next = { ...nodes }
  for (const node of Object.values(nodes)) {
    if (node.type !== 'separator' || node.parentId !== levelId) continue
    const [x, y] = node.start,
      dx = node.end[0] - x,
      dy = node.end[1] - y
    const length = Math.hypot(dx, dy)
    if (length < 1e-7) continue
    let ranges: [number, number][] = [[0, 1]]
    for (const [a, b] of lines) {
      if ([a, b].some((p) => Math.abs((p.x - x) * dy - (p.y - y) * dx) / length > 1e-6)) continue
      const ts = [a, b].map((p) => ((p.x - x) * dx + (p.y - y) * dy) / (length * length))
      const lo = Math.min(...ts),
        hi = Math.max(...ts)
      ranges = ranges.flatMap(([start, end]) => {
        if (hi <= start + 1e-7 || lo >= end - 1e-7) return [[start, end]]
        return [
          ...(lo > start + 1e-7 ? [[start, lo] as [number, number]] : []),
          ...(hi < end - 1e-7 ? [[hi, end] as [number, number]] : []),
        ]
      })
    }
    if (ranges.length === 1 && ranges[0]![0] === 0 && ranges[0]![1] === 1) continue
    if (!ranges.length) {
      delete next[node.id]
      patches.push({ op: 'delete', id: node.id })
    }
    for (const [i, [a, b]] of ranges.entries()) {
      const separator = omitUndefined(
        SeparatorNode.parse({
          ...node,
          id: i ? mintId() : node.id,
          start: [x + dx * a, y + dy * a],
          end: [x + dx * b, y + dy * b],
        }),
      )
      next[separator.id] = separator
      patches.push(
        i
          ? { op: 'create', node: separator }
          : { op: 'update', id: node.id, data: { start: separator.start, end: separator.end } },
      )
    }
  }
  if (patches.length) {
    const level = next[levelId]
    if (level?.type === 'level') {
      const children = [
        ...level.children.filter((id) => !!next[id]),
        ...patches.flatMap((p) =>
          p.op === 'create' && p.node.type === 'separator' ? [p.node.id] : [],
        ),
      ]
      next[levelId] = { ...level, children }
      patches.push({ op: 'update', id: level.id, data: { children } })
    }
  }
  return { nodes: patches.length ? next : nodes, patches }
}
