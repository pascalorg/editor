import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode, ZoneNode } from '../../schema'
import useScene from '../../store/use-scene'
import { mergeWallFaceRegions, planWallMerge, wallStyleMismatch } from './wall-merge'
import type { WallTopologyChanges } from './wall-topology'

const level = LevelNode.parse({ id: 'level_mf', children: [] })
const map = (nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
const apply = (nodes: Record<AnyNodeId, AnyNode>, changes: WallTopologyChanges) => {
  const next = { ...nodes }
  for (const { id, data } of changes.update) next[id] = { ...next[id]!, ...data } as AnyNode
  for (const id of changes.delete) delete next[id]
  return next
}
const wall = (start: [number, number], end: [number, number], extra: Partial<WallNode> = {}) =>
  WallNode.parse({ parentId: level.id, start, end, ...extra })
const room = (walls: WallNode[], extra: Partial<ZoneNode> = {}) =>
  ZoneNode.parse({
    name: 'Room',
    parentId: level.id,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    boundaryWallIds: walls.map((w) => w.id),
    ...extra,
  })

describe('merge compares what each face shows, in the merged direction', () => {
  test('face slots are compared after reading the other wall backwards', () => {
    const a = wall([0, 0], [2, 0], { slots: { a: 'library:red' } })
    // Drawn the other way: its face b is a's face a.
    const sameLook = wall([4, 0], [2, 0], { slots: { b: 'library:red' } })
    const otherLook = wall([4, 0], [2, 0], { slots: { a: 'library:red' } })
    expect(wallStyleMismatch(a, sameLook, { sides: false })).toBeNull()
    expect(wallStyleMismatch(a, otherLook, { sides: false })).toBe('side A finish')
    expect(() => planWallMerge(map([a, otherLook]), [a.id, otherLook.id])).toThrow(
      'These walls have a different side A finish.',
    )
  })

  test('trims must draw the same on the same faces', () => {
    const a = wall([0, 0], [2, 0], { skirting: { enabled: true, sides: 'a' } as never })
    const mirrored = wall([4, 0], [2, 0], { skirting: { enabled: true, sides: 'b' } as never })
    const opposite = wall([4, 0], [2, 0], { skirting: { enabled: true, sides: 'a' } as never })
    const recoloured = wall([2, 0], [4, 0], {
      skirting: { enabled: true, sides: 'a' } as never,
      slots: { aSkirting: 'library:oak' },
    })
    expect(wallStyleMismatch(a, mirrored, { sides: false })).toBeNull()
    expect(wallStyleMismatch(a, opposite, { sides: false })).toBe('trim')
    expect(wallStyleMismatch(a, recoloured, { sides: false })).toBe('trim')
  })
})

describe('merge carries room overrides onto the kept wall', () => {
  test('an absorbed wall read backwards hands its override over on the swapped face', () => {
    const a = wall([0, 0], [2, 0])
    const b = wall([4, 0], [2, 0])
    const zone = room([a, b], {
      wallOverrides: [
        { wallId: a.id, face: 'a', finish: 'library:accent' },
        { wallId: b.id, face: 'b', finish: 'library:accent' },
      ],
    })
    const plan = planWallMerge(map([a, b, zone]), [a.id, b.id])
    const merged = apply(map([a, b, zone]), plan.changes)
    // The kept wall keeps its own direction; the room sits on its a side if it is `a`.
    const face = plan.wallId === a.id ? 'a' : 'b'
    expect((merged[zone.id] as ZoneNode).wallOverrides).toEqual([
      { wallId: plan.wallId, face, finish: 'library:accent' },
    ])
    expect((merged[zone.id] as ZoneNode).boundaryWallIds).toEqual([plan.wallId])
  })

  test('refuses when the walls disagree on a room face they both border', () => {
    const a = wall([0, 0], [2, 0])
    const b = wall([2, 0], [4, 0])
    const differing = room([a, b], {
      wallOverrides: [
        { wallId: a.id, face: 'a', finish: 'library:one' },
        { wallId: b.id, face: 'a', finish: 'library:two' },
      ],
    })
    expect(() => planWallMerge(map([a, b, differing]), [a.id, b.id])).toThrow('room finish')
    const halfPainted = room([a, b], {
      wallOverrides: [{ wallId: a.id, face: 'a', finish: 'library:one' }],
    })
    expect(() => planWallMerge(map([a, b, halfPainted]), [a.id, b.id])).toThrow('room finish')
  })
})

describe('merge rebases paint regions', () => {
  test('stations move to the merged start, faces follow the direction, open ends stay open', () => {
    const a = wall([0, 0], [2, 0], {
      faceRegions: [{ id: 'dado', face: 'a', u0: 0.5, v1: 0.9, finish: 'library:wood' }],
    })
    const b = wall([4, 0], [2, 0], {
      faceRegions: [{ id: 'dado', face: 'b', u1: 1, v1: 0.9, finish: 'library:wood' }],
    })
    expect(mergeWallFaceRegions([a, b], [0, 0], [4, 0])).toEqual([
      { id: 'dado', face: 'a', u0: 0.5, u1: 2, v1: 0.9, finish: 'library:wood' },
      { id: `dado-${b.id}`, face: 'a', u0: 3, v1: 0.9, finish: 'library:wood' },
    ])
  })

  test('a region continuing across the joint coalesces into one', () => {
    const a = wall([0, 0], [2, 0], {
      faceRegions: [{ id: 'band-a-lower', face: 'a', v1: 0.9, finish: 'library:wood' }],
    })
    const b = wall([2, 0], [4, 0], {
      faceRegions: [{ id: 'band-a-lower', face: 'a', v1: 0.9, finish: 'library:wood' }],
    })
    const plan = planWallMerge(map([a, b]), [a.id, b.id])
    const kept = apply(map([a, b]), plan.changes)[plan.wallId] as WallNode
    expect(kept.faceRegions).toEqual([
      { id: 'band-a-lower', face: 'a', v1: 0.9, finish: 'library:wood' },
    ])
  })

  test('refuses a merge that would leave more than eight regions on a face', () => {
    const regions = (count: number, offset: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `r${offset + i}`,
        face: 'a' as const,
        u0: 0.1 + i * 0.3,
        u1: 0.2 + i * 0.3,
        finish: `library:c${offset + i}`,
      }))
    const a = wall([0, 0], [2, 0], { faceRegions: regions(5, 0) })
    const b = wall([2, 0], [4, 0], { faceRegions: regions(5, 5) })
    expect(mergeWallFaceRegions([a, b], [0, 0], [4, 0])).toBeNull()
    expect(() => planWallMerge(map([a, b]), [a.id, b.id])).toThrow('paint regions')
  })
})

describe('delete heal', () => {
  let saved: ReturnType<typeof useScene.getState>
  const raf = globalThis.requestAnimationFrame
  const cancel = globalThis.cancelAnimationFrame
  beforeEach(() => {
    saved = useScene.getState()
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
  })
  afterEach(() => {
    useScene.setState(saved)
    globalThis.requestAnimationFrame = raf
    globalThis.cancelAnimationFrame = cancel
  })

  test('rejoins painted walls with rebased regions and remapped overrides', () => {
    const a = wall([0, 0], [2, 0], {
      faceRegions: [{ id: 'dado', face: 'a', u0: 1, v1: 0.9, finish: 'library:wood' }],
    })
    const b = wall([4, 0], [2, 0])
    const stub = wall([2, 0], [2, -1])
    const zone = room([a, b], {
      wallOverrides: [
        { wallId: a.id, face: 'a', finish: 'library:accent' },
        { wallId: b.id, face: 'b', finish: 'library:accent' },
      ],
    })
    const nodes = map([a, b, stub, zone])
    ;(nodes[level.id] as LevelNode).children = [a.id, b.id, stub.id, zone.id] as never
    useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() } as never)
    useScene.getState().deleteNode(stub.id as AnyNodeId)
    const state = useScene.getState().nodes
    const survivors = Object.values(state).filter((n): n is WallNode => n.type === 'wall')
    expect(survivors).toHaveLength(1)
    const kept = survivors[0]!
    expect([kept.start, kept.end]).toEqual(
      kept.id === a.id
        ? [
            [0, 0],
            [4, 0],
          ]
        : [
            [4, 0],
            [0, 0],
          ],
    )
    const keptFace = kept.id === a.id ? 'a' : 'b'
    expect(kept.faceRegions).toEqual([
      kept.id === a.id
        ? { id: 'dado', face: 'a', u0: 1, u1: 2, v1: 0.9, finish: 'library:wood' }
        : { id: 'dado', face: 'b', u0: 2, u1: 3, v1: 0.9, finish: 'library:wood' },
    ])
    expect((state[zone.id as AnyNodeId] as ZoneNode).wallOverrides).toEqual([
      { wallId: kept.id, face: keptFace, finish: 'library:accent' },
    ])
  })
})
