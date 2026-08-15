import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId, CommentId } from '@pascal-app/core/schema'
import { WallNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCommentTools } from './comments'

type ListPayload = {
  comments: Array<{
    id: string
    body: string
    author: string
    resolved: boolean
    anchor: { position: [number, number, number]; nodeId?: string }
    replies: Array<{ author: string; body: string }>
  }>
  total: number
  openCount: number
}

describe('comment tools', () => {
  let client: Client
  let bridge: SceneBridge
  let wallId: string

  const addComment = (body: string, nodeId?: string) =>
    useScene.getState().createComment({
      body,
      author: { name: 'Taha' },
      anchor: { position: [1, 0, 2], ...(nodeId ? { nodeId: nodeId as AnyNodeId } : {}) },
    })

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
    wallId = bridge.createNode(
      WallNode.parse({ parentId: levelId, start: [0, 0], end: [4, 0] }) as AnyNode,
      levelId,
    ) as string

    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCommentTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  async function list(args: Record<string, unknown> = {}): Promise<ListPayload> {
    const result = await client.callTool({ name: 'list_comments', arguments: args })
    return JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0]!.text,
    ) as ListPayload
  }

  async function reply(args: Record<string, unknown>) {
    const result = await client.callTool({ name: 'reply_to_comment', arguments: args })
    return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text) as {
      commentId: string
      replyCount: number
      resolved: boolean
    }
  }

  // The gap this closes: comments are not nodes, so every node accessor in the
  // server looks straight past them.
  test('surfaces a thread that no node accessor would show', async () => {
    addComment('This wall is on the wrong side', wallId)
    const payload = await list()

    expect(payload.comments).toHaveLength(1)
    expect(payload.comments[0]?.body).toBe('This wall is on the wrong side')
    expect(payload.comments[0]?.anchor.nodeId).toBe(wallId)
    expect(payload.comments[0]?.author).toBe('Taha')
  })

  test('returns open threads by default and resolved ones only when asked', async () => {
    const open = addComment('Still needs a door')
    const done = addComment('Fixed already')
    useScene.getState().setCommentResolved(done, true)

    expect((await list()).comments.map((c) => c.id)).toEqual([open as string])
    expect((await list({ status: 'resolved' })).comments.map((c) => c.id)).toEqual([done as string])
    expect((await list({ status: 'all' })).total).toBe(2)
  })

  test('reports the open count even when the page is filtered', async () => {
    addComment('One', wallId)
    addComment('Two')

    const payload = await list({ nodeId: wallId })

    expect(payload.total).toBe(1)
    expect(payload.openCount).toBe(2)
  })

  test('filters to the threads pinned on one node', async () => {
    addComment('On the wall', wallId)
    addComment('In empty space')

    const payload = await list({ nodeId: wallId })

    expect(payload.comments).toHaveLength(1)
    expect(payload.comments[0]?.body).toBe('On the wall')
  })

  test('appends a reply that reads back on the thread', async () => {
    const id = addComment('Make it 20cm', wallId)
    const payload = await reply({ commentId: id, body: 'Thickened to 0.2m.' })

    expect(payload.replyCount).toBe(1)
    expect(payload.resolved).toBe(false)
    const thread = (await list()).comments[0]
    expect(thread?.replies[0]).toMatchObject({ author: 'Assistant', body: 'Thickened to 0.2m.' })
  })

  test('resolves the thread when the reply is the fix', async () => {
    const id = addComment('Make it 20cm', wallId)
    const payload = await reply({ commentId: id, body: 'Done.', resolve: true })

    expect(payload.resolved).toBe(true)
    expect((await list()).comments).toHaveLength(0)
    expect((await list({ status: 'resolved' })).comments).toHaveLength(1)
  })

  test('attributes the reply to a given name', async () => {
    const id = addComment('Question')
    await reply({ commentId: id, body: 'Answer', author: 'Pascal' })

    expect((await list()).comments[0]?.replies[0]?.author).toBe('Pascal')
  })

  // Comments are exempt from history on purpose: undo must not swallow one.
  test('replying adds no undo step', async () => {
    const id = addComment('Anything')
    const before = useScene.temporal.getState().pastStates.length

    await reply({ commentId: id, body: 'Noted.' })

    expect(useScene.temporal.getState().pastStates.length).toBe(before)
  })

  test('names an unknown thread as an error rather than silently doing nothing', async () => {
    await expect(reply({ commentId: 'comment_nope' as CommentId, body: 'Hi' })).rejects.toThrow()
  })
})
