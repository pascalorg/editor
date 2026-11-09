import { describe, expect, test } from 'bun:test'
import { LocalAppError, probeLocalApp, sendGlbToLocalApp, waitForLocalImport } from './send-to-app'

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

function fakeFetch(handler: Handler): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('probeLocalApp', () => {
  test('reports unreachable when nothing answers on any port', async () => {
    const tried: string[] = []
    const probe = await probeLocalApp(
      fakeFetch((url) => {
        tried.push(url)
        throw new TypeError('Failed to fetch')
      }),
      27412,
      3,
    )
    expect(probe).toEqual({ status: 'unreachable' })
    expect(tried).toEqual([
      'http://127.0.0.1:27412/pascal/health',
      'http://127.0.0.1:27413/pascal/health',
      'http://127.0.0.1:27414/pascal/health',
    ])
  })

  test('finds the app on a fallback port and tells whether it allows this origin', async () => {
    const health = { app: 'blender', version: '5.2.1', addon: '0.1.0', port: 27413, allowed: false }
    const probe = await probeLocalApp(
      fakeFetch((url) => {
        if (url.startsWith('http://127.0.0.1:27413/')) return json(health)
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(probe).toEqual({ status: 'refused', base: 'http://127.0.0.1:27413', health })
  })
})

describe('sendGlbToLocalApp', () => {
  test('posts the GLB with percent-encoded project headers', async () => {
    let seen: RequestInit | undefined
    const status = await sendGlbToLocalApp(
      'http://127.0.0.1:27412',
      new Blob([new Uint8Array([1, 2, 3])]),
      { name: 'Maison été', projectId: 'project_1' },
      fakeFetch((_url, init) => {
        seen = init
        return json({ id: 'abc', state: 'queued' }, 202)
      }),
    )
    expect(status).toEqual({ id: 'abc', state: 'queued' })
    expect(seen?.method).toBe('POST')
    expect(seen?.headers).toEqual({
      'Content-Type': 'model/gltf-binary',
      'X-Pascal-Project-Name': 'Maison%20%C3%A9t%C3%A9',
      'X-Pascal-Project-Id': 'project_1',
    })
  })

  test('maps a 403 to a refused error', async () => {
    await expect(
      sendGlbToLocalApp(
        'http://127.0.0.1:27412',
        new Blob([]),
        {},
        fakeFetch(() => json({ error: 'origin_not_allowed' }, 403)),
      ),
    ).rejects.toMatchObject({ name: 'LocalAppError', reason: 'refused' })
  })
})

describe('waitForLocalImport', () => {
  test('polls until the import is done', async () => {
    let calls = 0
    const status = await waitForLocalImport(
      'http://127.0.0.1:27412',
      'abc',
      fakeFetch(() => {
        calls += 1
        return json(
          calls < 3
            ? { id: 'abc', state: 'queued' }
            : { id: 'abc', state: 'done', summary: 'Imported' },
        )
      }),
      { intervalMs: 1 },
    )
    expect(status.state).toBe('done')
    expect(calls).toBe(3)
  })

  test('surfaces a failed import', async () => {
    const error = await waitForLocalImport(
      'http://127.0.0.1:27412',
      'abc',
      fakeFetch(() => json({ id: 'abc', state: 'failed', error: 'boom' })),
      { intervalMs: 1 },
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LocalAppError)
    expect((error as LocalAppError).reason).toBe('failed')
  })
})
