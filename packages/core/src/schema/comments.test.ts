import { describe, expect, test } from 'bun:test'
import {
  type CommentAnchor,
  type CommentId,
  type CommentThread,
  normalizeComments,
  resolveCommentAnchorPosition,
  sortCommentThreads,
} from './comments'
import type { AnyNodeId } from './types'

const pointAnchor: CommentAnchor = { position: [1, 2, 3] }

const thread = (id: string, createdAt: string): CommentThread => ({
  id: id as CommentId,
  anchor: pointAnchor,
  author: { name: 'Ada' },
  body: 'body',
  createdAt,
  replies: [],
})

const bag = (...threads: CommentThread[]): Record<CommentId, CommentThread> =>
  Object.fromEntries(threads.map((t) => [t.id, t])) as Record<CommentId, CommentThread>

describe('sortCommentThreads', () => {
  test('sorts oldest first', () => {
    const sorted = sortCommentThreads(
      bag(
        thread('c', '2026-03-01T00:00:00.000Z'),
        thread('a', '2026-01-01T00:00:00.000Z'),
        thread('b', '2026-02-01T00:00:00.000Z'),
      ),
    )
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  test('breaks timestamp ties by id so the sort is total', () => {
    const at = '2026-01-01T00:00:00.000Z'
    const sorted = sortCommentThreads(bag(thread('b', at), thread('a', at)))
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('resolveCommentAnchorPosition', () => {
  const nowhere = () => null

  test('returns a bare pin position unchanged', () => {
    expect(resolveCommentAnchorPosition(pointAnchor, nowhere)).toEqual([1, 2, 3])
  })

  test('adds the offset to the anchored node position', () => {
    const at = () => [10, 0, 10] as [number, number, number]
    const anchor: CommentAnchor = {
      position: [4, 2.5, 4],
      nodeId: 'shelf_1' as AnyNodeId,
      offset: [0, 2.5, 0],
    }
    expect(resolveCommentAnchorPosition(anchor, at)).toEqual([10, 2.5, 10])
  })

  test('falls back to the recorded position when the node cannot be resolved', () => {
    const anchor: CommentAnchor = {
      position: [4, 2.5, 4],
      nodeId: 'wall_gone' as AnyNodeId,
      offset: [0, 2.5, 0],
    }
    expect(resolveCommentAnchorPosition(anchor, nowhere)).toEqual([4, 2.5, 4])
  })

  // A wall has `start`/`end`, not `position`, so the editor's resolver has no
  // origin to offset from. The thread still names the wall; the pin just stays
  // where it was dropped.
  test('a node anchor with no offset never tries to follow', () => {
    const at = () => [99, 99, 99] as [number, number, number]
    const anchor: CommentAnchor = { position: [4, 2.5, 4], nodeId: 'wall_1' as AnyNodeId }
    expect(resolveCommentAnchorPosition(anchor, at)).toEqual([4, 2.5, 4])
  })
})

describe('normalizeComments', () => {
  test('returns an empty bag for a non-object', () => {
    expect(normalizeComments(undefined)).toEqual({})
    expect(normalizeComments([])).toEqual({})
  })

  test('drops a thread whose anchor cannot be placed', () => {
    const result = normalizeComments({
      c1: { id: 'c1', anchor: { position: [1, 2] }, body: 'x' },
      c2: { id: 'c2', anchor: { position: [1, 2, 3] }, body: 'y' },
    })
    expect(Object.keys(result)).toEqual(['c2'])
  })

  test('keeps the node reference and offset when both are well formed', () => {
    const result = normalizeComments({
      c1: {
        anchor: { position: [1, 2, 3], nodeId: 'shelf_1', offset: [0, 1, 0] },
        body: 'x',
      },
      c2: { anchor: { position: [1, 2, 3], nodeId: 'shelf_1', offset: [0, 1] }, body: 'y' },
    })
    expect(result['c1' as CommentId]?.anchor).toEqual({
      position: [1, 2, 3],
      nodeId: 'shelf_1' as AnyNodeId,
      offset: [0, 1, 0],
    })
    // A malformed offset drops to "does not follow" rather than taking the
    // thread down with it.
    expect(result['c2' as CommentId]?.anchor.offset).toBeUndefined()
    expect(result['c2' as CommentId]?.anchor.nodeId).toBe('shelf_1' as AnyNodeId)
  })

  test('keys off the record key when the entry has no id', () => {
    const result = normalizeComments({
      c1: { anchor: pointAnchor, body: 'x', createdAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(result['c1' as CommentId]?.id).toBe('c1' as CommentId)
  })

  test('falls back to a placeholder author rather than dropping the thread', () => {
    const result = normalizeComments({ c1: { anchor: pointAnchor, body: 'x' } })
    expect(result['c1' as CommentId]?.author).toEqual({ name: 'Unknown' })
  })

  test('keeps a valid camera pose and drops a malformed one', () => {
    const camera = { position: [1, 1, 1], target: [0, 0, 0], projection: 'perspective' }
    const result = normalizeComments({
      c1: { anchor: pointAnchor, body: 'x', camera },
      c2: { anchor: pointAnchor, body: 'y', camera: { position: [1, 1, 1] } },
    })
    expect(result['c1' as CommentId]?.camera).toEqual(camera as never)
    expect(result['c2' as CommentId]?.camera).toBeUndefined()
  })

  test('round-trips replies and drops bodyless ones', () => {
    const result = normalizeComments({
      c1: {
        anchor: pointAnchor,
        body: 'x',
        replies: [
          { id: 'r1', author: { name: 'Ada' }, body: 'yes', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'r2', author: { name: 'Ada' } },
        ],
      },
    })
    expect(result['c1' as CommentId]?.replies.map((r) => r.id)).toEqual(['r1' as never])
  })

  test('preserves resolved state and level', () => {
    const result = normalizeComments({
      c1: {
        anchor: pointAnchor,
        body: 'x',
        resolved: true,
        resolvedAt: '2026-02-01T00:00:00.000Z',
        resolvedBy: { name: 'Grace' },
        levelId: 'level_1',
      },
    })
    const t = result['c1' as CommentId]
    expect(t?.resolved).toBe(true)
    expect(t?.resolvedBy).toEqual({ name: 'Grace' })
    expect(t?.levelId).toBe('level_1' as AnyNodeId)
  })

  test('an unresolved thread carries no resolved field at all', () => {
    const result = normalizeComments({ c1: { anchor: pointAnchor, body: 'x', resolved: false } })
    expect(result['c1' as CommentId]).not.toHaveProperty('resolved')
  })
})
