import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { createSceneOperations, type SceneOperations } from '../operations'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import { registerEditorRequestTools } from './editor-requests'

function makeGraph(): SceneGraph {
  return {
    nodes: {
      site_abc: {
        object: 'node',
        id: 'site_abc',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
      },
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_abc'] as SceneGraph['rootNodeIds'],
  }
}

type AwaitPayload = {
  timedOut: boolean
  requestId?: number
  sceneId?: string
  prompt?: string
}

describe('editor request channel', () => {
  let root: string
  let store: SqliteSceneStore
  let operations: SceneOperations
  let client: Client
  let sceneId: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-editor-req-'))
    store = new SqliteSceneStore({ databasePath: path.join(root, 'pascal.db') })
    sceneId = (await store.save({ name: 'Plan', graph: makeGraph() })).id
    operations = createSceneOperations({ store })

    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerEditorRequestTools(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  afterEach(async () => {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
  }

  // The whole point of the channel: a prompt typed in the editor reaches an
  // agent that has no other way of being spoken to.
  test('hands the editor prompt to the agent that asks for work', async () => {
    await store.createAgentRequest({ sceneId, prompt: 'thin the interior walls' })

    const payload: AwaitPayload = await call('await_editor_request', {
      sceneId,
      timeoutSeconds: 1,
    })

    expect(payload.timedOut).toBe(false)
    expect(payload.prompt).toBe('thin the interior walls')
    expect(payload.requestId).toBeGreaterThan(0)
    expect(payload.sceneId).toBe(sceneId)
  })

  // An empty wait is the normal case, not a failure — the agent loops on it.
  test('an empty queue times out instead of erroring', async () => {
    const payload: AwaitPayload = await call('await_editor_request', {
      sceneId,
      timeoutSeconds: 1,
    })

    expect(payload.timedOut).toBe(true)
    expect(payload.prompt).toBeUndefined()
  })

  test('picks up a prompt that arrives while it is already waiting', async () => {
    const waiting = call('await_editor_request', { sceneId, timeoutSeconds: 5 })
    setTimeout(() => {
      void store.createAgentRequest({ sceneId, prompt: 'arrived late' })
    }, 300)

    const payload: AwaitPayload = await waiting

    expect(payload.timedOut).toBe(false)
    expect(payload.prompt).toBe('arrived late')
  })

  test('a claimed prompt is not handed out twice', async () => {
    await store.createAgentRequest({ sceneId, prompt: 'only once' })

    const first: AwaitPayload = await call('await_editor_request', { sceneId, timeoutSeconds: 1 })
    const second: AwaitPayload = await call('await_editor_request', { sceneId, timeoutSeconds: 1 })

    expect(first.prompt).toBe('only once')
    expect(second.timedOut).toBe(true)
  })

  test('the answer lands on the request for the editor to show', async () => {
    const created = await store.createAgentRequest({ sceneId, prompt: 'how many walls?' })
    await call('await_editor_request', { sceneId, timeoutSeconds: 1 })

    const payload = await call('answer_editor_request', {
      requestId: created.requestId,
      answer: 'Twelve, all interior.',
    })

    expect(payload.status).toBe('answered')
    const stored = await store.listAgentRequests(sceneId)
    expect(stored[0]?.answer).toBe('Twelve, all interior.')
  })

  test('answering an id that does not exist is an error, not a silent no-op', async () => {
    await expect(
      call('answer_editor_request', { requestId: 9999, answer: 'hello' }),
    ).rejects.toThrow()
  })
})
