import { describe, expect, test } from 'bun:test'
import { wallSlice } from '../../commands/structure/zone-wall-merge'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '../../schema'
import useScene from '../../store/use-scene'
import { reverseWallDirection } from './wall-frame'
import { planWallMerge } from './wall-merge'
import { planWallSplitAtPoint, type WallTopologyChanges } from './wall-topology'

// A physical strip from x=1 to x=6 must remain there when its wall's reference
// frame reverses, splits, or merges. Expected stations are analytic, not obtained
// through the production span-reprojection helper.
const level = LevelNode.parse({ id: 'level_trim_lifecycle', level: 0 })
const graph = (...walls: WallNode[]) =>
  Object.fromEntries([level, ...walls].map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
const apply = (nodes: Record<AnyNodeId, AnyNode>, changes: WallTopologyChanges) => {
  const next = { ...nodes }
  for (const id of changes.delete) delete next[id]
  for (const { node, parentId } of changes.create)
    next[node.id] = { ...node, parentId: parentId ?? node.parentId } as AnyNode
  for (const { id, data } of changes.update) next[id] = { ...next[id], ...data } as AnyNode
  return next
}

// Normalize sparse open-ended persisted intervals for observation only.
function physicalCoverage(wall: WallNode, kind: 'skirting' | 'crown' | 'chairRail') {
  const trim = wall[kind]
  if (!trim?.enabled) return []
  const length = Math.abs(wall.end[0] - wall.start[0])
  const direction = wall.end[0] > wall.start[0] ? 1 : -1
  const spans: { face: string; u0?: number; u1?: number }[] =
    trim.spans ?? (trim.sides === 'both' ? ['a', 'b'] : [trim.sides]).map((face) => ({ face }))
  return spans
    .map((span) => {
      const ends = [span.u0 ?? 0, span.u1 ?? length]
        .map((u) => wall.start[0] + direction * u)
        .sort((a, b) => a - b)
      return {
        side: direction > 0 ? span.face : span.face === 'a' ? 'b' : 'a',
        from: ends[0],
        to: ends[1],
      }
    })
    .sort((a, b) => a.from! - b.from!)
}

describe('bounded trim survives native wall topology', () => {
  test('deleting a perpendicular junction heals surviving walls without filling the trim gap', () => {
    const saved = useScene.getState()
    const raf = globalThis.requestAnimationFrame
    const cancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    try {
      const trims = (face: 'a' | 'b') =>
        Object.fromEntries(
          ['skirting', 'crown', 'chairRail'].map((kind) => [
            kind,
            { enabled: true, sides: face, spans: [{ face, u0: 1, u1: 3 }] },
          ]),
        )
      const first = WallNode.parse({
        id: 'wall_trim_heal_a',
        parentId: level.id,
        start: [0, 0],
        end: [4, 0],
        ...trims('a'),
      })
      const second = WallNode.parse({
        id: 'wall_trim_heal_b',
        parentId: level.id,
        start: [8, 0],
        end: [4, 0],
        ...trims('b'),
      })
      const stub = WallNode.parse({
        id: 'wall_trim_heal_stub',
        parentId: level.id,
        start: [4, 0],
        end: [4, -2],
      })
      const nodes = graph(first, second, stub)
      nodes[level.id] = { ...level, children: [first.id, second.id, stub.id] }
      useScene.setState({
        nodes,
        rootNodeIds: [level.id],
        dirtyNodes: new Set(),
        readOnly: false,
      })
      useScene.getState().deleteNode(stub.id)
      const survivors = Object.values(useScene.getState().nodes).filter(
        (node): node is WallNode => node.type === 'wall',
      )
      expect(survivors).toHaveLength(1)
      for (const kind of ['skirting', 'crown', 'chairRail'] as const)
        expect(physicalCoverage(survivors[0]!, kind)).toEqual([
          { side: 'a', from: 1, to: 3 },
          { side: 'a', from: 5, to: 7 },
        ])
    } finally {
      useScene.setState(saved)
      globalThis.requestAnimationFrame = raf
      globalThis.cancelAnimationFrame = cancel
    }
  })

  for (const kind of ['skirting', 'crown', 'chairRail'] as const) {
    test(`${kind} room-transform wall slicing clips and rebases the surviving tail`, () => {
      const original = WallNode.parse({
        id: 'wall_trim_slice',
        parentId: level.id,
        start: [0, 0],
        end: [8, 0],
        [kind]: { enabled: true, sides: 'a', spans: [{ face: 'a', u0: 0, u1: 4 }] },
      })
      const before = structuredClone(original)
      const bareTail = wallSlice(original, [4, 0], [8, 0], 'wall_trim_bare_tail')
      expect(physicalCoverage(bareTail, kind)).toEqual([])
      const crossing = WallNode.parse({
        ...original,
        [kind]: { enabled: true, sides: 'a', spans: [{ face: 'a', u0: 1, u1: 6 }] },
      })
      const trimmedTail = wallSlice(crossing, [4, 0], [8, 0], 'wall_trim_tail')
      expect(physicalCoverage(trimmedTail, kind)).toEqual([{ side: 'a', from: 4, to: 6 }])
      expect(original).toEqual(before)
    })

    test(`${kind} reversal preserves physical side and stations and round-trips`, () => {
      const original = WallNode.parse({
        id: 'wall_trim_reverse',
        parentId: level.id,
        start: [0, 0],
        end: [8, 0],
        [kind]: { enabled: true, sides: 'a', spans: [{ face: 'a', u0: 1, u1: 6 }] },
      })
      const reversed = { ...original, ...reverseWallDirection(original) }
      expect(reversed[kind]?.spans).toEqual([{ face: 'b', u0: 2, u1: 7 }])
      expect(physicalCoverage(reversed, kind)).toEqual([{ side: 'a', from: 1, to: 6 }])
      expect({ ...reversed, ...reverseWallDirection(reversed) }).toEqual(original)
    })

    test(`${kind} split clips and rebases coverage without extending into bare wall`, () => {
      const original = WallNode.parse({
        id: 'wall_trim_split',
        parentId: level.id,
        start: [0, 0],
        end: [8, 0],
        [kind]: { enabled: true, sides: 'a', spans: [{ face: 'a', u0: 1, u1: 6 }] },
      })
      const nodes = graph(original)
      const before = structuredClone(nodes)
      const split = planWallSplitAtPoint(nodes, { levelId: level.id, point: [4, 0], radius: 0.05 })
      if (!split.ok) throw new Error('expected supported straight-wall split')
      const next = apply(nodes, split.plan.changes)
      const pieces = Object.values(next)
        .filter((node): node is WallNode => node.type === 'wall')
        .sort((a, b) => a.start[0] - b.start[0])
      expect(pieces).toHaveLength(2)
      expect(physicalCoverage(pieces[0]!, kind)).toEqual([{ side: 'a', from: 1, to: 4 }])
      expect(physicalCoverage(pieces[1]!, kind)).toEqual([{ side: 'a', from: 4, to: 6 }])
      expect(nodes).toEqual(before)
    })

    test(`${kind} merge rebases both walls and preserves the untrimmed gap`, () => {
      const a = WallNode.parse({
        id: 'wall_trim_merge_a',
        parentId: level.id,
        start: [0, 0],
        end: [4, 0],
        [kind]: { enabled: true, sides: 'a', spans: [{ face: 'a', u0: 1, u1: 3 }] },
      })
      const b = WallNode.parse({
        id: 'wall_trim_merge_b',
        parentId: level.id,
        start: [8, 0],
        end: [4, 0],
        [kind]: { enabled: true, sides: 'b', spans: [{ face: 'b', u0: 1, u1: 3 }] },
      })
      const nodes = graph(a, b)
      const before = structuredClone(nodes)
      const plan = planWallMerge(nodes, [a.id, b.id])
      const merged = apply(nodes, plan.changes)[plan.wallId] as WallNode
      expect(physicalCoverage(merged, kind)).toEqual([
        { side: 'a', from: 1, to: 3 },
        { side: 'a', from: 5, to: 7 },
      ])
      expect(nodes).toEqual(before)
    })
  }
})
