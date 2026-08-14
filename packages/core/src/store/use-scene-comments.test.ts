import { beforeEach, describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, SiteNode, WallNode } from '../schema'
import type { CommentAnchor } from '../schema/comments'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene, { clearSceneHistory } from './use-scene'

const anchor: CommentAnchor = { kind: 'point', position: [1, 0, 2] }

function baseScene() {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ parentId: building.id, level: 0, children: [] })
  const nodes: Record<AnyNodeId, AnyNode> = {
    [site.id]: { ...site, children: [building.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: level,
  }
  return { nodes, rootNodeIds: [site.id] as AnyNodeId[], levelId: level.id }
}

beforeEach(() => {
  const { nodes, rootNodeIds } = baseScene()
  useScene.getState().setScene(nodes, rootNodeIds)
  useScene.getState().setReadOnly(false)
  clearSceneHistory()
})

describe('comment CRUD', () => {
  test('creates a thread with a generated id, timestamp and empty replies', () => {
    const id = useScene.getState().createComment({ anchor, author: { name: 'Ada' }, body: 'hm' })
    const thread = useScene.getState().comments[id]
    expect(thread?.id).toBe(id)
    expect(thread?.body).toBe('hm')
    expect(thread?.replies).toEqual([])
    expect(Number.isNaN(Date.parse(thread?.createdAt ?? ''))).toBe(false)
  })

  test('updates a thread without letting the id be overwritten', () => {
    const id = useScene.getState().createComment({ anchor, author: { name: 'Ada' }, body: 'a' })
    useScene.getState().updateComment(id, { body: 'b' })
    expect(useScene.getState().comments[id]?.body).toBe('b')
    expect(useScene.getState().comments[id]?.id).toBe(id)
  })

  test('deletes a thread', () => {
    const id = useScene.getState().createComment({ anchor, author: { name: 'Ada' }, body: 'a' })
    useScene.getState().deleteComment(id)
    expect(useScene.getState().comments[id]).toBeUndefined()
  })

  test('unresolving strips every resolved field rather than writing false', () => {
    const id = useScene.getState().createComment({ anchor, author: { name: 'Ada' }, body: 'a' })
    useScene.getState().setCommentResolved(id, true, { name: 'Grace' })
    expect(useScene.getState().comments[id]?.resolved).toBe(true)
    expect(useScene.getState().comments[id]?.resolvedBy).toEqual({ name: 'Grace' })

    useScene.getState().setCommentResolved(id, false)
    const thread = useScene.getState().comments[id]
    expect(thread).not.toHaveProperty('resolved')
    expect(thread).not.toHaveProperty('resolvedAt')
    expect(thread).not.toHaveProperty('resolvedBy')
  })
})

describe('comment replies', () => {
  test('appends a reply in order', () => {
    const id = useScene.getState().createComment({ anchor, author: { name: 'Ada' }, body: 'a' })
    useScene.getState().addCommentReply(id, { author: { name: 'Bo' }, body: 'first' })
    useScene.getState().addCommentReply(id, { author: { name: 'Cy' }, body: 'second' })
    expect(useScene.getState().comments[id]?.replies.map((r) => r.body)).toEqual([
      'first',
      'second',
    ])
  })

  test('returns null for a thread that does not exist', () => {
    const result = useScene
      .getState()
      .addCommentReply('comment_missing' as never, { author: { name: 'Bo' }, body: 'x' })
    expect(result).toBeNull()
  })

  test('edits and deletes a single reply', () => {
    const id = useScene.getState().createComment({ anchor, author: { name: 'Ada' }, body: 'a' })
    const keep = useScene.getState().addCommentReply(id, { author: { name: 'Bo' }, body: 'keep' })
    const drop = useScene.getState().addCommentReply(id, { author: { name: 'Cy' }, body: 'drop' })
    if (!keep || !drop) throw new Error('reply ids expected')

    useScene.getState().updateCommentReply(id, keep, { body: 'kept' })
    useScene.getState().deleteCommentReply(id, drop)

    const replies = useScene.getState().comments[id]?.replies ?? []
    expect(replies.map((r) => r.body)).toEqual(['kept'])
    expect(replies[0]?.id).toBe(keep)
  })
})

describe('comments sit outside the edit model', () => {
  test('a view-only visitor can still comment while the scene is read-only', () => {
    useScene.getState().setReadOnly(true)
    const id = useScene.getState().createComment({ anchor, author: { name: 'Guest' }, body: 'a' })
    expect(useScene.getState().comments[id]?.body).toBe('a')

    useScene.getState().addCommentReply(id, { author: { name: 'Guest' }, body: 'r' })
    useScene.getState().setCommentResolved(id, true)
    expect(useScene.getState().comments[id]?.replies).toHaveLength(1)
    expect(useScene.getState().comments[id]?.resolved).toBe(true)

    // The lock still holds for the model itself.
    expect(useScene.getState().createSavedView).toBeDefined()
    expect(useScene.getState().createCollection('nope')).toBe('' as never)
  })

  test('undo does not swallow a comment left after the edit it describes', () => {
    const { levelId } = baseScene()
    const wall = WallNode.parse({
      parentId: levelId,
      start: [0, 0],
      end: [4, 0],
    })
    useScene.getState().createNode(wall as AnyNode, levelId)
    const id = useScene
      .getState()
      .createComment({ anchor, author: { name: 'Ada' }, body: 'too thin' })

    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[wall.id]).toBeUndefined()
    expect(useScene.getState().comments[id]?.body).toBe('too thin')
  })
})
