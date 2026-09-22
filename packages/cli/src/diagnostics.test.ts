import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectInfo, runDoctor } from './diagnostics.js'
import { resolvePascalPaths } from './paths.js'
import { installBundledRuntime } from './runtime.js'

test('doctor reports corrupt managed state instead of crashing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-doctor-'))
  try {
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    await mkdir(paths.run, { recursive: true })
    await writeFile(paths.currentRuntime, '{not-json')

    const checks = await runDoctor(paths)

    expect(checks).toContainEqual(expect.objectContaining({ id: 'runtime', status: 'fail' }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('doctor warns when the active runtime is not the one this CLI ships', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-doctor-'))
  try {
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })
    const source = path.join(root, 'runtime-1.2.3')
    await mkdir(path.join(source, 'apps/editor'), { recursive: true })
    await writeFile(
      path.join(source, 'runtime-manifest.json'),
      JSON.stringify({ schemaVersion: 2, version: '1.2.3', entrypoint: 'apps/editor/server.js' }),
    )
    await writeFile(path.join(source, 'apps/editor/server.js'), '')
    await installBundledRuntime(paths, source)
    const runtimeSourceFile = path.join(root, 'runtime-source.json')
    await writeFile(
      runtimeSourceFile,
      JSON.stringify({
        version: '2.0.0',
        url: 'https://127.0.0.1:1/pascal-web-runtime-2.0.0.tar.gz',
        sha256: 'a'.repeat(64),
        size: 10,
      }),
    )

    const checks = await runDoctor(paths, { runtimeSourceFile })

    expect(checks).toContainEqual(
      expect.objectContaining({
        id: 'runtime',
        status: 'warn',
        message: expect.stringContaining('this CLI ships 2.0.0'),
      }),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('info creates private local storage on a fresh home', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-info-'))
  try {
    const paths = resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') })

    await collectInfo(paths)

    expect((await stat(paths.root)).mode & 0o077).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
