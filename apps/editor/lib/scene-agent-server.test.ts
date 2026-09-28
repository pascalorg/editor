import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { createSceneOperations } from '../../../packages/mcp/src/operations/scene-operations'
import type { SceneStore, SceneWithGraph } from '../../../packages/mcp/src/storage/types'
import { DELETE, PATCH, PUT } from '../app/api/scenes/[id]/route'
import { forwardSceneAgentRequest, isAgentManagedScene } from './scene-agent-server'
import { __resetSceneStoreForTests, __setSceneStoreForTests } from './scene-store-server'

const SCENE_ID = 'managed-scene'
const SERVER_TOKEN = 'test-only-server-activity-token'
const CLIENT_TOKEN = 'test-only-browser-scene-token'
const GRAPH = { nodes: { n1: { id: 'n1', type: 'qa:box' } }, rootNodeIds: ['n1'] }
const ENV_KEYS = [
  'PASCAL_AGENT_SCENE_ID',
  'PASCAL_AGENT_ACTIVITY_URL',
  'PASCAL_AGENT_ACTIVITY_TOKEN',
  'PASCAL_SCENE_API_TOKEN',
  'PASCAL_SCENE_API_ORIGINS',
  'PASCAL_SCENE_API_RATE_LIMIT',
] as const

let oldEnv: Record<string, string | undefined>
let restoreFetch = () => {}
let fetchCalls: { url: string; init?: RequestInit }[]
let respond: () => Promise<Response>
let directWrites = 0

beforeEach(() => {
  oldEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  process.env.PASCAL_AGENT_SCENE_ID = SCENE_ID
  process.env.PASCAL_AGENT_ACTIVITY_URL = 'http://127.0.0.1:4290/untrusted-path?discard=me'
  process.env.PASCAL_AGENT_ACTIVITY_TOKEN = SERVER_TOKEN
  process.env.PASCAL_SCENE_API_TOKEN = CLIENT_TOKEN
  process.env.PASCAL_SCENE_API_RATE_LIMIT = '0'
  delete process.env.PASCAL_SCENE_API_ORIGINS
  fetchCalls = []
  directWrites = 0
  respond = async () => Response.json({ revision: 8 })
  const replacement = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      fetchCalls.push({ url: input instanceof Request ? input.url : String(input), init })
      return respond()
    },
    {
      preconnect: () => {
        throw new Error('Unexpected network preconnect')
      },
    },
  )
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(replacement)
  restoreFetch = () => fetchSpy.mockRestore()

  const existing = {
    id: SCENE_ID,
    name: 'Managed scene',
    projectId: null,
    thumbnailUrl: null,
    version: 7,
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    ownerId: null,
    sizeBytes: 100,
    nodeCount: 1,
    graph: GRAPH,
  } as SceneWithGraph
  const unexpectedWrite = async (): Promise<never> => {
    directWrites += 1
    throw new Error('Managed edits must not fall back to the local scene store')
  }
  const store: SceneStore = {
    backend: 'sqlite',
    load: async (id) => (id === SCENE_ID ? existing : null),
    list: async () => [],
    save: unexpectedWrite,
    delete: unexpectedWrite,
    rename: unexpectedWrite,
  }
  __setSceneStoreForTests(store, createSceneOperations({ store }))
})

afterEach(() => {
  restoreFetch()
  __resetSceneStoreForTests()
  for (const key of ENV_KEYS) {
    const value = oldEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function request(method = 'GET', body?: unknown, extraHeaders?: HeadersInit) {
  const headers = new Headers({
    host: '127.0.0.1:4288',
    authorization: `Bearer ${CLIENT_TOKEN}`,
    'content-type': 'application/json',
  })
  new Headers(extraHeaders).forEach((value, key) => {
    headers.set(key, value)
  })
  return new NextRequest(`http://127.0.0.1:4288/api/scenes/${SCENE_ID}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: SCENE_ID }) }

describe('scene agent proxy', () => {
  test('only the configured scene is managed and forwarded', async () => {
    expect(isAgentManagedScene(SCENE_ID)).toBe(true)
    for (const id of ['', 'another-scene', 'managed-scene-suffix']) {
      expect(isAgentManagedScene(id)).toBe(false)
      const response = await forwardSceneAgentRequest(request(), id, '')
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'agent_not_configured' })
    }
    expect(fetchCalls).toHaveLength(0)
  })

  test('keeps service credentials server-side and binds the forwarded scene', async () => {
    respond = async () =>
      Response.json(
        { activity: { status: 'paused' } },
        {
          headers: { Authorization: `Bearer ${SERVER_TOKEN}`, 'Set-Cookie': 'upstream=private' },
        },
      )
    const response = await forwardSceneAgentRequest(request('POST'), SCENE_ID, 'pause', {
      runId: 'run-1',
    })
    expect(fetchCalls).toHaveLength(1)
    const call = fetchCalls[0]!
    expect(call.url).toBe('http://127.0.0.1:4290/activity/pause')
    expect(call.init?.method).toBe('POST')
    const headers = new Headers(call.init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${SERVER_TOKEN}`)
    expect(headers.get('x-pascal-scene-id')).toBe(SCENE_ID)
    expect(call.init?.body).toBe(JSON.stringify({ runId: 'run-1' }))
    expect(String(call.init?.body)).not.toContain(CLIENT_TOKEN)
    expect(response.headers.get('authorization')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).not.toContain(SERVER_TOKEN)
  })

  test('blocks an external browser origin before any service request', async () => {
    const response = await forwardSceneAgentRequest(
      request('POST', undefined, { Origin: 'https://untrusted.example' }),
      SCENE_ID,
      'stop',
      { runId: 'run-1' },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'origin_not_allowed' })
    expect(fetchCalls).toHaveLength(0)
  })

  test('requires the browser-facing credential independently of the service credential', async () => {
    const response = await forwardSceneAgentRequest(
      request('GET', undefined, { Authorization: `Bearer ${SERVER_TOKEN}` }),
      SCENE_ID,
      '',
    )
    expect(response.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })

  test('invalid or missing service configuration fails closed without fetching', async () => {
    for (const url of [
      undefined,
      '',
      'invalid',
      'https://127.0.0.1:4290',
      'http://external.example',
      'http://user:pass@localhost:4290',
    ]) {
      if (url === undefined) delete process.env.PASCAL_AGENT_ACTIVITY_URL
      else process.env.PASCAL_AGENT_ACTIVITY_URL = url
      const response = await forwardSceneAgentRequest(request(), SCENE_ID, '')
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'agent_control_unavailable' })
    }
    process.env.PASCAL_AGENT_ACTIVITY_URL = 'http://127.0.0.1:4290'
    delete process.env.PASCAL_AGENT_ACTIVITY_TOKEN
    expect((await forwardSceneAgentRequest(request(), SCENE_ID, '')).status).toBe(503)
    expect(fetchCalls).toHaveLength(0)
  })

  test('preserves service refusal statuses and bodies without retry or fallback', async () => {
    for (const status of [401, 403, 409, 503]) {
      respond = async () => Response.json({ error: `upstream_${status}` }, { status })
      const count = fetchCalls.length
      const response = await forwardSceneAgentRequest(request('POST'), SCENE_ID, 'stop', {
        runId: 'run-1',
      })
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: `upstream_${status}` })
      expect(fetchCalls.length).toBe(count + 1)
    }
    expect(directWrites).toBe(0)
  })

  test('a connection failure produces a generic unavailable response', async () => {
    respond = async () => {
      throw new Error(`Failed to connect with ${SERVER_TOKEN}`)
    }
    const response = await forwardSceneAgentRequest(request(), SCENE_ID, '')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'agent_control_unavailable' })
    expect(fetchCalls).toHaveLength(1)
    expect(directWrites).toBe(0)
  })

  test('forwards SSE without buffering its content or exposing private headers', async () => {
    const text = 'event: activity\ndata: {"status":"running"}\n\n'
    respond = async () => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
    const incoming = request()
    const response = await forwardSceneAgentRequest(incoming, SCENE_ID, 'events')
    expect(fetchCalls[0]?.url).toBe('http://127.0.0.1:4290/activity/events')
    expect(fetchCalls[0]?.init?.signal).toBe(incoming.signal)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(await response.text()).toBe(text)
  })
})

describe('managed scene PUT', () => {
  test('requires both the run identity and an expected revision before forwarding', async () => {
    for (const body of [
      { graph: GRAPH },
      { graph: GRAPH, agentRunId: 'run-1' },
      { graph: GRAPH, expectedVersion: 7 },
    ]) {
      const response = await PUT(request('PUT', body), params)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'agent_handoff_required' })
    }
    expect(fetchCalls).toHaveLength(0)
    expect(directWrites).toBe(0)
  })

  test('retains managed ownership on service failures and never saves directly', async () => {
    for (const status of [409, 503]) {
      respond = async () => Response.json({ error: 'control_rejected' }, { status })
      const response = await PUT(
        request('PUT', {
          graph: GRAPH,
          agentRunId: 'run-1',
          expectedVersion: 7,
        }),
        params,
      )
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: 'control_rejected' })
    }
    delete process.env.PASCAL_AGENT_ACTIVITY_TOKEN
    const response = await PUT(
      request('PUT', {
        graph: GRAPH,
        agentRunId: 'run-1',
        expectedVersion: 7,
      }),
      params,
    )
    expect(response.status).toBe(503)
    expect(fetchCalls).toHaveLength(2)
    expect(directWrites).toBe(0)
  })

  test('returns the acknowledged revision and routes the graph through human-edit only', async () => {
    const response = await PUT(
      request(
        'PUT',
        {
          graph: GRAPH,
          agentRunId: 'run-1',
          expectedVersion: 999,
        },
        { 'If-Match': '"7"' },
      ),
      params,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"8"')
    expect(await response.json()).toMatchObject({ id: SCENE_ID, version: 8, nodeCount: 1 })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe('http://127.0.0.1:4290/activity/human-edit')
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      runId: 'run-1',
      expectedRevision: 7,
      graph: GRAPH,
    })
    expect(new Headers(fetchCalls[0]?.init?.headers).get('x-pascal-scene-id')).toBe(SCENE_ID)
    expect(directWrites).toBe(0)
  })

  test('retains the empty-overwrite guard before the controlled save', async () => {
    const response = await PUT(
      request('PUT', {
        graph: { nodes: {}, rootNodeIds: [] },
        agentRunId: 'run-1',
        expectedVersion: 7,
      }),
      params,
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'empty_graph_rejected' })
    expect(fetchCalls).toHaveLength(0)
    expect(directWrites).toBe(0)
  })

  test('managed DELETE and PATCH cannot bypass the handoff through direct writes', async () => {
    for (const response of [
      await DELETE(request('DELETE'), params),
      await PATCH(request('PATCH', { name: 'Renamed', expectedVersion: 7 }), params),
    ]) {
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'agent_managed_scene' })
    }
    expect(fetchCalls).toHaveLength(0)
    expect(directWrites).toBe(0)
  })
})
