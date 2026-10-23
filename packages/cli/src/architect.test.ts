import { describe, expect, test } from 'bun:test'
import {
  ARCHITECT_RESPONSES_ENDPOINT,
  cancelArchitectRun,
  getArchitectRun,
  startArchitectRun,
  streamArchitectRun,
} from './architect.js'
import { CliError } from './errors.js'

const API_KEY = 'sk_live_architect-test-key'

const QUEUED = {
  id: 'resp_architect1',
  object: 'response',
  status: 'queued',
  model: 'architect-high',
  created_at: 1_790_000_000,
  metadata: { project_id: 'proj_1', pascal_max_credits: '40' },
  output: [],
}

const COMPLETED = {
  ...QUEUED,
  status: 'completed',
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Two-storey house\u001b[2J placed.' }],
    },
  ],
}

interface Captured {
  url: string
  method?: string
  authorization: string | null
  accept: string | null
  redirect?: RequestRedirect
  body: unknown
}

function captureFetch(respond: () => Response, calls: Captured[] = []): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: headers.get('authorization'),
      accept: headers.get('accept'),
      redirect: init?.redirect,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return respond()
  }
}

function sse(events: unknown[], { close = true } = {}): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          const type = (event as { type: string }).type
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`))
        }
        if (close) controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('architect runs', () => {
  test('queues a background run with the effort model and Pascal metadata', async () => {
    const calls: Captured[] = []
    const run = await startArchitectRun(
      API_KEY,
      { brief: '  A three-bedroom house  ', effort: 'high', projectId: 'proj_1', maxCredits: 40 },
      { fetch: captureFetch(() => Response.json(QUEUED), calls) },
    )

    expect(calls).toEqual([
      {
        url: ARCHITECT_RESPONSES_ENDPOINT,
        method: 'POST',
        authorization: `Bearer ${API_KEY}`,
        accept: 'application/json',
        redirect: 'error',
        body: {
          model: 'architect-high',
          input: 'A three-bedroom house',
          background: true,
          store: true,
          stream: false,
          metadata: { project_id: 'proj_1', pascal_max_credits: '40' },
        },
      },
    ])
    expect(run).toEqual({
      schemaVersion: 1,
      id: 'resp_architect1',
      status: 'queued',
      model: 'architect-high',
      projectId: 'proj_1',
      maxCredits: 40,
      createdAt: new Date(1_790_000_000 * 1000).toISOString(),
      outputText: null,
      error: null,
    })
  })

  test('uses the default architect model without metadata when no options are set', async () => {
    const calls: Captured[] = []
    await startArchitectRun(
      API_KEY,
      { brief: 'A cabin' },
      { fetch: captureFetch(() => Response.json(QUEUED), calls) },
    )

    expect(calls[0]?.body).toEqual({
      model: 'architect',
      input: 'A cabin',
      background: true,
      store: true,
      stream: false,
    })
  })

  test('streams text deltas and returns the terminal run with terminal-safe output', async () => {
    const calls: Captured[] = []
    const started: string[] = []
    const deltas: string[] = []
    const run = await streamArchitectRun(
      API_KEY,
      { brief: 'A cabin', effort: 'low' },
      {
        fetch: captureFetch(
          () =>
            sse([
              { type: 'response.created', response: QUEUED },
              { type: 'response.in_progress', response: { ...QUEUED, status: 'in_progress' } },
              { type: 'response.output_text.delta', delta: 'Two-storey ' },
              { type: 'response.output_text.delta', delta: 'house\u001b[2J placed.' },
              { type: 'response.completed', response: COMPLETED },
            ]),
          calls,
        ),
        onStarted: (value) => started.push(value.id),
        onText: (delta) => deltas.push(delta),
      },
    )

    expect(calls[0]?.accept).toBe('text/event-stream')
    expect(calls[0]?.body).toMatchObject({ model: 'architect-low', background: true, stream: true })
    expect(started).toEqual(['resp_architect1'])
    expect(deltas).toEqual(['Two-storey ', 'house[2J placed.'])
    expect(run.status).toBe('completed')
    expect(run.outputText).toBe('Two-storey house[2J placed.')
  })

  test('reports a dropped stream with the run ID so the caller can resume', async () => {
    const error = await captureError(() =>
      streamArchitectRun(
        API_KEY,
        { brief: 'A cabin' },
        { fetch: async () => sse([{ type: 'response.created', response: QUEUED }]) },
      ),
    )

    expect(error.code).toBe('architect_stream_interrupted')
    expect(error.details).toEqual({ id: 'resp_architect1' })
    expect(error.message).toContain('pascal architect status resp_architect1')
  })

  test('detaches without cancelling when the caller aborts mid-stream', async () => {
    const detach = new AbortController()
    const error = await captureError(() =>
      streamArchitectRun(
        API_KEY,
        { brief: 'A cabin' },
        {
          fetch: async () =>
            sse([{ type: 'response.created', response: QUEUED }], { close: false }),
          signal: detach.signal,
          onStarted: () => queueMicrotask(() => detach.abort()),
        },
      ),
    )

    expect(error.code).toBe('architect_detached')
    expect(error.exitCode).toBe(130)
    expect(error.details).toEqual({ id: 'resp_architect1' })
  })

  test('reads and cancels a run by ID', async () => {
    const calls: Captured[] = []
    const fetchMock = captureFetch(() => Response.json(COMPLETED), calls)

    const status = await getArchitectRun(API_KEY, 'resp_architect1', { fetch: fetchMock })
    await cancelArchitectRun(API_KEY, 'resp_architect1', { fetch: fetchMock })

    expect(calls.map(({ url, method }) => [method, url])).toEqual([
      ['GET', `${ARCHITECT_RESPONSES_ENDPOINT}/resp_architect1`],
      ['POST', `${ARCHITECT_RESPONSES_ENDPOINT}/resp_architect1/cancel`],
    ])
    expect(status.outputText).toBe('Two-storey house[2J placed.')
  })

  test('keeps a failed run error bounded and terminal-safe', async () => {
    const run = await getArchitectRun(API_KEY, 'resp_architect1', {
      fetch: async () =>
        Response.json({
          ...QUEUED,
          status: 'failed',
          error: { code: 'credit_limit_reached', message: `Limit\u001b[31m ${'x'.repeat(900)}` },
        }),
    })

    expect(run.error?.code).toBe('credit_limit_reached')
    expect(run.error?.message?.startsWith('Limit[31m x')).toBe(true)
    expect(run.error?.message?.length).toBe(500)
  })

  test('rejects run IDs that could change the request path', async () => {
    let called = false
    const error = await captureError(() =>
      getArchitectRun(API_KEY, '../admin', {
        fetch: async () => {
          called = true
          return Response.json(COMPLETED)
        },
      }),
    )

    expect(error.code).toBe('invalid_option')
    expect(called).toBe(false)
  })

  test.each([
    [{ brief: '   ' }],
    [{ brief: 'A cabin', maxCredits: 0 }],
    [{ brief: 'A cabin', projectId: '' }],
    [{ brief: 'A cabin', effort: 'max' as never }],
  ])('rejects invalid run options before any request: %j', async (request) => {
    const error = await captureError(() =>
      startArchitectRun(API_KEY, request, {
        fetch: async () => {
          throw new Error('fetch must not be called')
        },
      }),
    )

    expect(error.code).toBe('invalid_option')
    expect(error.exitCode).toBe(2)
  })

  test('requires the agent credential', async () => {
    const error = await captureError(() => startArchitectRun(undefined, { brief: 'A cabin' }))

    expect(error.code).toBe('agent_api_key_missing')
  })

  test('maps executor_unavailable to a retryable error that says no run started', async () => {
    const fetchMock: typeof fetch = async () =>
      Response.json(
        { error: { type: 'server_error', code: 'executor_unavailable', message: 'busy' } },
        { status: 503 },
      )

    const error = await captureError(() =>
      startArchitectRun(API_KEY, { brief: 'A cabin' }, { fetch: fetchMock }),
    )

    expect(error.code).toBe('architect_executor_unavailable')
    expect(error.exitCode).toBe(75)
    expect(error.message).toContain('the run was not started')
    expect(error.details).toEqual({ status: 503, code: 'executor_unavailable' })
  })

  test('maps an executor_unavailable stream error event the same way', async () => {
    const error = await captureError(() =>
      streamArchitectRun(
        API_KEY,
        { brief: 'A cabin' },
        {
          fetch: async () =>
            sse([{ type: 'error', code: 'executor_unavailable', message: 'no executor' }]),
        },
      ),
    )

    expect(error.code).toBe('architect_executor_unavailable')
  })

  test.each([
    [401, 'architect_unauthorized', 1],
    [402, 'architect_insufficient_credits', 1],
    [403, 'architect_forbidden', 1],
    [404, 'architect_run_not_found', 1],
    [429, 'architect_rate_limited', 75],
    [503, 'architect_unavailable', 75],
    [500, 'architect_failed', 1],
  ])('maps HTTP %i without exposing the key or response body', async (status, code, exitCode) => {
    const fetchMock: typeof fetch = async () =>
      new Response(`<html>credential ${API_KEY} rejected</html>`, {
        headers: { 'content-type': 'text/html' },
        status,
      })

    const error = await captureError(() =>
      getArchitectRun(API_KEY, 'resp_architect1', { fetch: fetchMock }),
    )

    expect(error.code).toBe(code)
    expect(error.exitCode).toBe(exitCode)
    expect(error.details).toEqual({ status })
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(error.message).not.toContain(API_KEY)
  })

  test('rejects responses that are not an architect run', async () => {
    const error = await captureError(() =>
      getArchitectRun(API_KEY, 'resp_architect1', {
        fetch: async () => Response.json({ id: 'resp_architect1', status: 'sleeping' }),
      }),
    )

    expect(error.code).toBe('architect_invalid_response')
  })
})

async function captureError(action: () => Promise<unknown>): Promise<CliError> {
  try {
    await action()
  } catch (error) {
    if (error instanceof CliError) return error
    throw error
  }
  throw new Error('Expected a CliError')
}
