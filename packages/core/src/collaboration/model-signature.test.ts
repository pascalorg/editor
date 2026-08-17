import { describe, expect, test } from 'bun:test'
import { BuildingNode } from '../schema/nodes/building'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { canonicalJson, hashModelSnapshot, sha256Hex } from './model-signature'
import { collaborationSnapshot } from './scene-collaboration'

describe('sha256Hex', () => {
  test('matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })
})

describe('canonicalJson', () => {
  test('sorts object keys so key order does not affect the result', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })

  test('preserves array order', () => {
    expect(canonicalJson([1, 2, 3])).toBe('[1,2,3]')
    expect(canonicalJson([3, 2, 1])).toBe('[3,2,1]')
  })
})

describe('hashModelSnapshot', () => {
  const buildingId = 'building_sig' as AnyNodeId
  const levelId = 'level_sig' as AnyNodeId

  function snapshot(name: string) {
    const level = LevelNode.parse({
      id: levelId,
      parentId: buildingId,
      children: [],
      level: 0,
      name,
    })
    const building = BuildingNode.parse({
      id: buildingId,
      parentId: null,
      children: [levelId],
    })
    return collaborationSnapshot({ [buildingId]: building, [levelId]: level }, [buildingId])
  }

  test('is key-order independent across equivalent snapshots', () => {
    const a = snapshot('Ground')
    // Rebuild the same content with the nodes inserted in the opposite order —
    // the two snapshots differ only in object insertion order, not content.
    const level = LevelNode.parse({
      id: levelId,
      parentId: buildingId,
      children: [],
      level: 0,
      name: 'Ground',
    })
    const building = BuildingNode.parse({
      id: buildingId,
      parentId: null,
      children: [levelId],
    })
    const b = collaborationSnapshot({ [levelId]: level, [buildingId]: building }, [buildingId])

    expect(hashModelSnapshot(a)).toBe(hashModelSnapshot(b))
  })

  test('changes with content', () => {
    expect(hashModelSnapshot(snapshot('Ground'))).not.toBe(hashModelSnapshot(snapshot('Lobby')))
  })

  test('ignores node field order but not node field values', () => {
    // Two nodes with identical content but different key insertion order.
    const nodeA = { type: 'level', id: 'n1', level: 1, name: 'Ground' } as unknown as AnyNode
    const nodeB = { name: 'Ground', level: 1, id: 'n1', type: 'level' } as unknown as AnyNode
    const snapshotA = collaborationSnapshot({ n1: nodeA } as never, ['n1'] as never)
    const snapshotB = collaborationSnapshot({ n1: nodeB } as never, ['n1'] as never)
    expect(hashModelSnapshot(snapshotA)).toBe(hashModelSnapshot(snapshotB))

    const renamed = { name: 'Lobby', level: 1, id: 'n1', type: 'level' } as unknown as AnyNode
    expect(
      hashModelSnapshot(collaborationSnapshot({ n1: renamed } as never, ['n1'] as never)),
    ).not.toBe(hashModelSnapshot(snapshotA))
  })
})
