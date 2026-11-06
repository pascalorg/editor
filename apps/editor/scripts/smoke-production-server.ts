import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Boots `next start` over the production build in `.next` and checks the
 * behaviour a Next or React upgrade can break without failing the build:
 * config redirects and headers, the proxy's locale and self-host gate,
 * server-rendered pages, route handlers, and that force-dynamic scene reads
 * are never served from a cache.
 */

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'pascal-next-smoke-'))
const port = await freePort()
const origin = `http://127.0.0.1:${port}`
let server: ChildProcess | null = null
const serverOutput: string[] = []
const REQUEST_TIMEOUT_MS = 15_000

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server?.kill('SIGKILL')
    process.exit(1)
  })
}

try {
  // Production runs `next start` on Node, so the smoke does too (not Bun's Node compatibility).
  server = spawn(
    'node',
    [
      createRequire(import.meta.url).resolve('next/dist/bin/next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(port),
    ],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PASCAL_DATA_DIR: dataDirectory,
        PASCAL_ADMIN_PASSWORD: '',
        PASCAL_AUTH: '',
        PASCAL_SCENE_API_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  server.stdout?.on('data', (chunk: Buffer) => serverOutput.push(chunk.toString()))
  server.stderr?.on('data', (chunk: Buffer) => serverOutput.push(chunk.toString()))
  await waitForHealth()

  await check('health route answers JSON', async () => {
    const response = await get(`${origin}/api/health`)
    expect(response.status === 200, `status ${response.status}`)
    const body = (await response.json()) as { status?: string; app?: string }
    expect(body.status === 'ok' && body.app === 'editor', JSON.stringify(body))
  })

  await check('config redirects keep old links working', async () => {
    for (const [from, to] of [
      ['/editor/smoke', '/project/smoke'],
      ['/scene/smoke', '/project/smoke'],
      ['/scenes', '/'],
    ]) {
      const response = await get(`${origin}${from}`, { redirect: 'manual' })
      const location = new URL(response.headers.get('location') ?? '', origin).pathname
      expect(
        response.status === 307 && location === to,
        `${from}: ${response.status} → ${location}`,
      )
    }
  })

  await check('embed pages allow framing', async () => {
    const response = await get(`${origin}/embed/smoke`)
    const policy = response.headers.get('content-security-policy')
    expect(policy === 'frame-ancestors *', `content-security-policy: ${policy}`)
  })

  await check('the proxy passes ?lang to the server-rendered layout', async () => {
    for (const [query, lang] of [
      ['', 'en'],
      ['?lang=fr', 'fr'],
    ]) {
      const response = await get(`${origin}/${query}`)
      const html = await response.text()
      expect(response.status === 200, `/${query}: status ${response.status}`)
      expect(
        new RegExp(`<html[^>]*\\slang="${lang}"`).test(html),
        `/${query} did not render <html lang="${lang}">`,
      )
    }
  })

  await check('the proxy gates a non-loopback host', async () => {
    const page = await requestWithHost('/', 'editor.example.com')
    expect(
      page.status === 307 && page.location?.endsWith('/setup') === true,
      `page: ${page.status} → ${page.location}`,
    )
    const api = await requestWithHost('/api/plugins/mint/manifest', 'editor.example.com')
    expect(
      api.status === 503 && api.body.includes('self_host_unconfigured'),
      `api: ${api.status} ${api.body}`,
    )
  })

  await check('scene routes round-trip without serving stale reads', async () => {
    const created = await get(`${origin}/api/scenes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'smoke-scene', name: 'Smoke scene', graph: sceneGraph() }),
    })
    expect(created.status === 201, `create: ${created.status} ${await created.clone().text()}`)

    const first = (await (await get(`${origin}/api/scenes/smoke-scene`)).json()) as {
      name?: string
      version?: number
    }
    expect(first.name === 'Smoke scene', `first read: ${JSON.stringify(first)}`)

    const renamed = await get(`${origin}/api/scenes/smoke-scene`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': `"${first.version}"` },
      body: JSON.stringify({ name: 'Renamed smoke scene' }),
    })
    expect(renamed.status === 200, `rename: ${renamed.status} ${await renamed.clone().text()}`)

    const second = (await (await get(`${origin}/api/scenes/smoke-scene`)).json()) as {
      name?: string
    }
    expect(second.name === 'Renamed smoke scene', `read after rename: ${JSON.stringify(second)}`)

    const listed = (await (await get(`${origin}/api/scenes`)).json()) as {
      scenes?: Array<{ id: string; name: string }>
    }
    expect(
      listed.scenes?.some((scene) => scene.id === 'smoke-scene' && scene.name === second.name) ===
        true,
      `list: ${JSON.stringify(listed)}`,
    )

    const stale = await get(`${origin}/api/scenes/smoke-scene`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': `"${first.version}"` },
      body: JSON.stringify({ name: 'Lost update' }),
    })
    expect(stale.status === 409, `stale rename: ${stale.status}`)
  })

  await check('a saved project page renders on the server', async () => {
    const response = await get(`${origin}/project/smoke-scene`)
    expect(response.status === 200, `status ${response.status}`)
    expect((await response.text()).includes('<html'), 'no HTML document')
  })

  await check('the image optimizer serves raster images and refuses SVG', async () => {
    const raster = await get(`${origin}/_next/image?url=%2Ficons%2Fappliance.webp&w=64&q=75`)
    expect(
      raster.status === 200 && raster.headers.get('content-type')?.startsWith('image/') === true,
      `webp: ${raster.status} ${raster.headers.get('content-type')}`,
    )
    const svg = await get(`${origin}/_next/image?url=%2Fglobe.svg&w=64&q=75`)
    const body = await svg.text()
    expect(
      svg.status === 400 && body.includes('image type is not allowed'),
      `svg: ${svg.status} ${body}`,
    )
  })

  console.log(`Next production server smoke passed on ${origin}.`)
} catch (error) {
  console.error(serverOutput.join('').slice(-4000))
  throw error
} finally {
  await stopServer()
  await rm(dataDirectory, { recursive: true, force: true })
}

function sceneGraph() {
  const levelId = 'level_smoke'
  return {
    nodes: { [levelId]: { object: 'node', id: levelId, type: 'level', level: 0, children: [] } },
    rootNodeIds: [levelId],
  }
}

function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const exited = once(server, 'exit')
  server.kill('SIGTERM')
  const timer = setTimeout(() => server?.kill('SIGKILL'), 10_000)
  await exited
  clearTimeout(timer)
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  await run()
  console.log(`ok - ${name}`)
}

function expect(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(detail)
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (!server || server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`next start exited (${server?.exitCode ?? server?.signalCode})`)
    }
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('next start did not become healthy within 60 s')
}

function requestWithHost(
  pathname: string,
  host: string,
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: pathname, headers: { host } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(new Error(`${pathname} timed out`)),
    )
    request.on('error', reject)
    request.end()
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      )
    })
  })
}
