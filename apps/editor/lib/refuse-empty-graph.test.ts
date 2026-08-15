import { describe, expect, test } from 'bun:test'
import { wouldEmptyStoredScene } from '@/app/api/scenes/[id]/route'

const graph = (nodeCount: number) => ({
  nodes: Object.fromEntries(Array.from({ length: nodeCount }, (_, i) => [`n${i}`, {}])),
  rootNodeIds: nodeCount > 0 ? ['n0'] : [],
})

describe('wouldEmptyStoredScene', () => {
  // A stale tab, an older build, or any third-party caller can PUT the
  // transient state between `unloadScene()` and a loaded graph. The client
  // guard is not enough on its own, because the client is what is broken.
  test('refuses an empty graph over a populated scene', () => {
    expect(wouldEmptyStoredScene(graph(0), graph(20))).toBe(true)
  })

  // Only the populated → empty direction is refused, so a genuinely blank
  // document stays writable.
  test('allows an empty graph when the stored scene is already empty', () => {
    expect(wouldEmptyStoredScene(graph(0), graph(0))).toBe(false)
  })

  test('allows any write that carries nodes', () => {
    expect(wouldEmptyStoredScene(graph(1), graph(20))).toBe(false)
    expect(wouldEmptyStoredScene(graph(20), graph(20))).toBe(false)
  })

  test('treats a missing or malformed graph as empty rather than throwing', () => {
    expect(wouldEmptyStoredScene(null, graph(20))).toBe(true)
    expect(wouldEmptyStoredScene({}, graph(20))).toBe(true)
    expect(wouldEmptyStoredScene(graph(5), null)).toBe(false)
  })
})
