import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  activateEditorRuntime,
  getEditorStatus,
  startEditor,
  stopEditor,
  waitForHealth,
} from './editor-process.js'
import { resolvePascalPaths } from './paths.js'
import { installBundledRuntime, readActiveRuntime } from './runtime.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('managed runtime', () => {
  test('installs a bundled runtime outside the package-runner cache', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })

    const active = await installBundledRuntime(paths, source)

    expect(active.version).toBe('1.2.3')
    expect(active.directory).toBe(path.join(paths.runtime, '1.2.3'))
    expect(await Bun.file(path.join(active.directory, 'apps/editor/server.js')).exists()).toBe(true)
  })

  test('starts, identifies, and stops a detached editor while preserving data', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    await mkdir(paths.data, { recursive: true })
    await writeFile(paths.database, 'persistent')

    const started = await startEditor({ paths, sourceDirectory: source })
    expect(started.alreadyRunning).toBe(false)
    expect((await getEditorStatus(paths)).healthy).toBe(true)
    expect((await startEditor({ paths, sourceDirectory: source })).alreadyRunning).toBe(true)

    expect(await stopEditor(paths)).toBe(true)
    expect((await getEditorStatus(paths)).running).toBe(false)
    expect(await Bun.file(paths.database).text()).toBe('persistent')
  })

  test('serializes concurrent starts into one managed editor', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })

    const [first, second] = await Promise.all([
      startEditor({ paths, port: 0, sourceDirectory: source }),
      startEditor({ paths, port: 0, sourceDirectory: source }),
    ])

    expect(first.state.pid).toBe(second.state.pid)
    expect([first.alreadyRunning, second.alreadyRunning].sort()).toEqual([false, true])
    await stopEditor(paths)
  })

  test('falls back to an automatic port when the requested port is occupied', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const foreignServer = http.createServer((_request, response) => response.end('foreign'))
    await new Promise<void>((resolve, reject) => {
      foreignServer.once('error', reject)
      foreignServer.listen({ host: '127.0.0.1', port: 0 }, resolve)
    })
    const address = foreignServer.address()
    if (!address || typeof address === 'string') throw new Error('foreign server has no TCP port')

    try {
      const started = await startEditor({
        paths,
        port: address.port,
        sourceDirectory: source,
      })

      expect(started.state.port).not.toBe(address.port)
      expect((await getEditorStatus(paths)).healthy).toBe(true)
      await stopEditor(paths)
    } finally {
      await new Promise<void>((resolve, reject) =>
        foreignServer.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  test('reports a foreign health responder without waiting for the timeout', async () => {
    const foreignServer = http.createServer((_request, response) => response.end('not Pascal'))
    await new Promise<void>((resolve, reject) => {
      foreignServer.once('error', reject)
      foreignServer.listen({ host: '127.0.0.1', port: 0 }, resolve)
    })
    const address = foreignServer.address()
    if (!address || typeof address === 'string') throw new Error('foreign server has no TCP port')

    try {
      const startedAt = Date.now()
      await expect(
        waitForHealth(
          {
            schemaVersion: 1,
            pid: process.pid,
            version: '1.2.3',
            port: address.port,
            host: '127.0.0.1',
            url: `http://pascal.localhost:${address.port}`,
            instanceId: 'expected-instance',
            runtimeDirectory: '/tmp/pascal-test-runtime',
            startedAt: new Date().toISOString(),
          },
          5_000,
        ),
      ).rejects.toMatchObject({ code: 'port_conflict' })
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
      await new Promise<void>((resolve, reject) =>
        foreignServer.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  test('reclaims an install lock whose owner is gone', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    await mkdir(paths.run, { recursive: true })
    await writeFile(
      path.join(paths.run, 'runtime-install.lock'),
      JSON.stringify({
        schemaVersion: 1,
        pid: 999_999,
        token: 'abandoned',
        createdAt: new Date().toISOString(),
      }),
    )

    expect((await installBundledRuntime(paths, source)).version).toBe('1.2.3')
  })

  test('replaces a damaged installed runtime on the next start', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const active = await installBundledRuntime(paths, source)
    await rm(path.join(active.directory, 'apps/editor/server.js'))

    const started = await startEditor({ paths, port: 0, sourceDirectory: source })

    expect(started.state.version).toBe('1.2.3')
    expect((await getEditorStatus(paths)).healthy).toBe(true)
    expect(await Bun.file(path.join(active.directory, 'apps/editor/server.js')).exists()).toBe(true)
    await stopEditor(paths)
  })

  test('replaces a runtime whose manifest contains invalid JSON', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const active = await installBundledRuntime(paths, source)
    await writeFile(path.join(active.directory, 'runtime-manifest.json'), '{not-json')

    const started = await startEditor({ paths, port: 0, sourceDirectory: source })

    expect(started.state.version).toBe('1.2.3')
    expect((await getEditorStatus(paths)).healthy).toBe(true)
    await stopEditor(paths)
  })

  test('recovers an active-runtime pointer containing invalid JSON', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    await mkdir(paths.run, { recursive: true })
    await writeFile(paths.currentRuntime, '{not-json')

    const started = await startEditor({ paths, port: 0, sourceDirectory: source })

    expect(started.state.version).toBe('1.2.3')
    expect((await getEditorStatus(paths)).healthy).toBe(true)
    await stopEditor(paths)
  })

  test('removes abandoned temporary runtime copies before installing', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const abandoned = path.join(paths.runtime, '.install-abandoned')
    await mkdir(abandoned, { recursive: true })
    await writeFile(path.join(abandoned, 'partial'), 'incomplete')

    await installBundledRuntime(paths, source)

    expect(await Bun.file(path.join(abandoned, 'partial')).exists()).toBe(false)
  })

  test('allows an explicit force stop only for the recorded editor command', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const started = await startEditor({ paths, port: 0, sourceDirectory: source })
    await writeFile(
      paths.state,
      `${JSON.stringify({ ...started.state, instanceId: 'no-longer-healthy' }, null, 2)}\n`,
    )

    await expect(stopEditor(paths)).rejects.toMatchObject({ code: 'state_conflict' })
    expect(await stopEditor(paths, { force: true })).toBe(true)
  })

  test('force-stops the recorded editor when its runtime manifest is damaged', async () => {
    const root = await temporaryRoot()
    const source = await fakeRuntime(root, '1.2.3')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const started = await startEditor({ paths, port: 0, sourceDirectory: source })
    await writeFile(path.join(started.state.runtimeDirectory, 'runtime-manifest.json'), '{not-json')
    await writeFile(
      paths.state,
      `${JSON.stringify({ ...started.state, instanceId: 'no-longer-healthy' }, null, 2)}\n`,
    )

    expect(await stopEditor(paths, { force: true })).toBe(true)
  })

  test('restores the previous running runtime when a candidate fails health', async () => {
    const root = await temporaryRoot()
    const firstSource = await fakeRuntime(root, '1.2.3')
    const brokenSource = await fakeRuntime(root, '2.0.0', false)
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    await startEditor({ paths, port: 0, sourceDirectory: firstSource })
    const candidate = await installBundledRuntime(paths, brokenSource, { activate: false })

    await expect(activateEditorRuntime(paths, candidate)).rejects.toMatchObject({
      code: 'update_failed',
    })
    expect((await readActiveRuntime(paths))?.version).toBe('1.2.3')
    expect((await getEditorStatus(paths)).healthy).toBe(true)
    await stopEditor(paths)
  })

  test('health-checks an update without leaving a stopped editor running', async () => {
    const root = await temporaryRoot()
    const firstSource = await fakeRuntime(root, '1.2.3')
    const secondSource = await fakeRuntime(root, '2.0.0')
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    await installBundledRuntime(paths, firstSource)
    const seeded = await startEditor({ paths, port: 0, sourceDirectory: firstSource })
    await stopEditor(paths)
    await writeFile(paths.state, `${JSON.stringify(seeded.state, null, 2)}\n`)
    const candidate = await installBundledRuntime(paths, secondSource, { activate: false })

    const result = await activateEditorRuntime(paths, candidate)

    expect(result).toEqual({ runtime: candidate, restarted: false })
    expect((await readActiveRuntime(paths))?.version).toBe('2.0.0')
    expect((await getEditorStatus(paths)).running).toBe(false)
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-test-'))
  roots.push(root)
  return root
}

async function fakeRuntime(root: string, version: string, healthy = true): Promise<string> {
  const runtime = path.join(root, `source-${version}`)
  const app = path.join(runtime, 'apps/editor')
  await mkdir(app, { recursive: true })
  await writeFile(
    path.join(runtime, 'runtime-manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      version,
      entrypoint: 'apps/editor/server.js',
      healthPath: '/api/health',
    }),
  )
  await writeFile(
    path.join(app, 'server.js'),
    healthy
      ? `import http from 'node:http'
const instanceId = process.env.PASCAL_INSTANCE_ID
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json')
  if (request.url === '/api/health') {
    response.end(JSON.stringify({
      status: 'ok',
      app: 'editor',
      version: process.env.PASCAL_RUNTIME_VERSION,
      instanceId,
    }))
    return
  }
  response.end('{}')
})
server.listen(Number(process.env.PORT), process.env.HOSTNAME)
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`
      : 'process.exit(1)\n',
  )
  return runtime
}
