import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isProxyBypassed, resolveProxyUrl } from './http-download.js'
import { resolvePascalPaths } from './paths.js'
import { findInstalledRuntime, installBundledRuntime, readActiveRuntime } from './runtime.js'
import {
  ensureWebRuntime,
  fileSha256,
  type RuntimeSource,
  readRuntimeSource,
  verifyArchiveDigest,
} from './runtime-download.js'
import { createRuntimeArchive } from './tar.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('archive digest verification', () => {
  test('accepts a matching digest whatever case it is written in', async () => {
    const fixture = await createFixture()

    await verifyArchiveDigest(fixture.archiveFile, fixture.source.sha256)
    await verifyArchiveDigest(fixture.archiveFile, fixture.source.sha256.toUpperCase())
  })

  test('rejects a changed archive and deletes it when asked to', async () => {
    const fixture = await createFixture()
    const tampered = await tamper(fixture.archiveFile, path.join(fixture.root, 'tampered.tar.gz'))

    await expect(
      verifyArchiveDigest(tampered, fixture.source.sha256, { deleteOnMismatch: true }),
    ).rejects.toMatchObject({
      code: 'runtime_digest_mismatch',
      message: expect.stringContaining(fixture.source.sha256),
    })
    expect(await exists(tampered)).toBe(false)
  })

  test('keeps a caller-supplied archive that fails verification', async () => {
    const fixture = await createFixture()
    const tampered = await tamper(fixture.archiveFile, path.join(fixture.root, 'tampered.tar.gz'))

    await expect(verifyArchiveDigest(tampered, fixture.source.sha256)).rejects.toMatchObject({
      code: 'runtime_digest_mismatch',
    })
    expect(await exists(tampered)).toBe(true)
  })
})

describe('published runtime source', () => {
  test('reads the archive URL and digest committed with the CLI', async () => {
    const fixture = await createFixture()

    expect(await readRuntimeSource(fixture.sourceFile)).toEqual(fixture.source)
  })

  test.each([
    ['is missing', null],
    ['is not JSON', '{not-json'],
    ['omits the digest', { version: '1.2.3', url: 'https://example.com/a.tar.gz', size: 10 }],
    [
      'carries a truncated digest',
      { version: '1.2.3', url: 'https://example.com/a.tar.gz', sha256: 'abc123', size: 10 },
    ],
    [
      'points at a plain-http URL',
      { version: '1.2.3', url: 'http://example.com/a.tar.gz', sha256: 'a'.repeat(64), size: 10 },
    ],
    [
      'declares an empty archive',
      { version: '1.2.3', url: 'https://example.com/a.tar.gz', sha256: 'a'.repeat(64), size: 0 },
    ],
    [
      'carries a path-like version',
      {
        version: '../escape',
        url: 'https://example.com/a.tar.gz',
        sha256: 'a'.repeat(64),
        size: 10,
      },
    ],
  ])('refuses a runtime source that %s', async (_label, content) => {
    const root = await temporaryRoot()
    const sourceFile = path.join(root, 'runtime-source.json')
    if (content !== null) {
      await writeFile(sourceFile, typeof content === 'string' ? content : JSON.stringify(content))
    }

    await expect(readRuntimeSource(sourceFile)).rejects.toMatchObject({
      code: 'invalid_runtime_source',
      message: expect.stringContaining('--runtime'),
    })
  })
})

describe('web runtime resolution order', () => {
  test('prefers an explicit runtime directory over the environment override', async () => {
    const fixture = await createFixture()
    const other = await fakeRuntimeDirectory(fixture.root, '9.9.9')

    const result = await ensureWebRuntime({
      paths: fixture.paths,
      runtimeSource: fixture.sourceDirectory,
      sourceFile: fixture.sourceFile,
      environment: { PASCAL_BUNDLED_RUNTIME_DIR: other },
    })

    expect(result.runtime.version).toBe('1.2.3')
    expect((await readActiveRuntime(fixture.paths))?.version).toBe('1.2.3')
    expect(await findInstalledRuntime(fixture.paths, '9.9.9')).toBeNull()
  })

  test('falls back to PASCAL_BUNDLED_RUNTIME_DIR when no flag is passed', async () => {
    const fixture = await createFixture()

    const result = await ensureWebRuntime({
      paths: fixture.paths,
      sourceFile: fixture.sourceFile,
      environment: { PASCAL_BUNDLED_RUNTIME_DIR: fixture.sourceDirectory },
    })

    expect(result).toMatchObject({ installed: true, runtime: { version: '1.2.3' } })
  })

  test('installs a local archive that matches the published digest', async () => {
    const fixture = await createFixture()

    const result = await ensureWebRuntime({
      paths: fixture.paths,
      runtimeSource: fixture.archiveFile,
      sourceFile: fixture.sourceFile,
      environment: {},
    })

    expect(result.runtime.directory).toBe(path.join(fixture.paths.runtime, '1.2.3'))
    expect(await exists(path.join(result.runtime.directory, 'apps/editor/server.js'))).toBe(true)
  })

  test('installs nothing when a local archive fails verification', async () => {
    const fixture = await createFixture()
    const tampered = await tamper(fixture.archiveFile, path.join(fixture.root, 'tampered.tar.gz'))

    await expect(
      ensureWebRuntime({
        paths: fixture.paths,
        runtimeSource: tampered,
        sourceFile: fixture.sourceFile,
        environment: {},
      }),
    ).rejects.toMatchObject({ code: 'runtime_digest_mismatch' })
    expect(await findInstalledRuntime(fixture.paths, '1.2.3')).toBeNull()
    expect(await exists(tampered)).toBe(true)
  })

  test('reports a missing runtime path instead of reaching for the network', async () => {
    const fixture = await createFixture()

    await expect(
      ensureWebRuntime({
        paths: fixture.paths,
        runtimeSource: path.join(fixture.root, 'absent.tar.gz'),
        sourceFile: fixture.sourceFile,
        environment: {},
      }),
    ).rejects.toMatchObject({ code: 'runtime_source_missing' })
  })

  test('reuses the installed runtime for this version without downloading', async () => {
    const fixture = await createFixture()
    await installBundledRuntime(fixture.paths, fixture.sourceDirectory, { activate: false })

    const result = await ensureWebRuntime({
      paths: fixture.paths,
      sourceFile: fixture.sourceFile,
      environment: {},
    })

    expect(result).toEqual({
      installed: false,
      runtime: {
        schemaVersion: 1,
        version: '1.2.3',
        directory: path.join(fixture.paths.runtime, '1.2.3'),
      },
    })
    expect((await readActiveRuntime(fixture.paths))?.version).toBe('1.2.3')
  })

  test('installs without activating so an update can health-check first', async () => {
    const fixture = await createFixture()

    const result = await ensureWebRuntime({
      paths: fixture.paths,
      runtimeSource: fixture.sourceDirectory,
      sourceFile: fixture.sourceFile,
      activate: false,
      environment: {},
    })

    expect(result.runtime.version).toBe('1.2.3')
    expect(await readActiveRuntime(fixture.paths)).toBeNull()
    expect(await findInstalledRuntime(fixture.paths, '1.2.3')).not.toBeNull()
  })

  test('names the archive, the digest and the offline escape hatch when the download fails', async () => {
    const fixture = await createFixture()

    const failure = await ensureWebRuntime({
      paths: fixture.paths,
      sourceFile: fixture.sourceFile,
      environment: {},
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'runtime_download_failed' })
    const message = (failure as Error).message
    expect(message).toContain(fixture.source.url)
    expect(message).toContain(fixture.source.sha256)
    expect(message).toContain('pascal editor --runtime')
    expect(message).toContain('HTTPS_PROXY')
    expect(await findInstalledRuntime(fixture.paths, '1.2.3')).toBeNull()
  })
})

describe('proxy configuration', () => {
  test('prefers HTTPS_PROXY and trims the configured value', () => {
    const target = new URL('https://github.com/pascalorg/editor')

    expect(resolveProxyUrl(target, { HTTPS_PROXY: ' http://proxy:3128 ' })).toBe(
      'http://proxy:3128',
    )
    expect(resolveProxyUrl(target, { ALL_PROXY: 'http://all:3128' })).toBe('http://all:3128')
    expect(resolveProxyUrl(target, { HTTPS_PROXY: '   ' })).toBeNull()
    expect(resolveProxyUrl(target, {})).toBeNull()
  })

  test('honours NO_PROXY for the download host', () => {
    const target = new URL('https://github.com/pascalorg/editor')

    expect(resolveProxyUrl(target, { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: '*' })).toBeNull()
    expect(
      resolveProxyUrl(target, { HTTPS_PROXY: 'http://proxy:3128', no_proxy: 'github.com' }),
    ).toBeNull()
    expect(
      resolveProxyUrl(target, { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: 'example.com' }),
    ).toBe('http://proxy:3128')
  })

  test('matches NO_PROXY entries by suffix and ignores ports', () => {
    expect(isProxyBypassed('release-assets.githubusercontent.com', '.githubusercontent.com')).toBe(
      true,
    )
    expect(isProxyBypassed('github.com', 'github.com:443')).toBe(true)
    expect(isProxyBypassed('github.com', '*.github.com')).toBe(true)
    expect(isProxyBypassed('notgithub.com', 'github.com')).toBe(false)
    expect(isProxyBypassed('github.com', '')).toBe(false)
    expect(isProxyBypassed('github.com', undefined)).toBe(false)
  })
})

interface Fixture {
  root: string
  paths: ReturnType<typeof resolvePascalPaths>
  sourceDirectory: string
  archiveFile: string
  sourceFile: string
  source: RuntimeSource
}

/** An unroutable port keeps every download test offline; the connection is refused at once. */
const UNREACHABLE_HOST = 'https://127.0.0.1:1'

async function createFixture(version = '1.2.3'): Promise<Fixture> {
  const root = await temporaryRoot()
  const sourceDirectory = await fakeRuntimeDirectory(root, version)
  const archiveFile = path.join(root, `pascal-web-runtime-${version}.tar.gz`)
  await createRuntimeArchive(sourceDirectory, archiveFile)
  const source: RuntimeSource = {
    version,
    url: `${UNREACHABLE_HOST}/pascal-web-runtime-${version}.tar.gz`,
    sha256: await fileSha256(archiveFile),
    size: (await stat(archiveFile)).size,
  }
  const sourceFile = path.join(root, 'runtime-source.json')
  await writeFile(sourceFile, JSON.stringify(source))
  return {
    root,
    paths: resolvePascalPaths({ PASCAL_HOME: path.join(root, 'home') }),
    sourceDirectory,
    archiveFile,
    sourceFile,
    source,
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-download-test-'))
  roots.push(root)
  return root
}

async function fakeRuntimeDirectory(root: string, version: string): Promise<string> {
  const runtime = path.join(root, `source-${version}`)
  await mkdir(path.join(runtime, 'apps/editor'), { recursive: true })
  await writeFile(
    path.join(runtime, 'runtime-manifest.json'),
    JSON.stringify({ schemaVersion: 2, version, entrypoint: 'apps/editor/server.js' }),
  )
  await writeFile(path.join(runtime, 'apps/editor/server.js'), `// pascal ${version}\n`)
  return runtime
}

async function tamper(archiveFile: string, destination: string): Promise<string> {
  await copyFile(archiveFile, destination)
  const handle = await open(destination, 'r+')
  try {
    const offset = Math.floor((await handle.stat()).size / 2)
    const byte = Buffer.alloc(1)
    await handle.read(byte, 0, 1, offset)
    byte[0] = ((byte[0] ?? 0) ^ 0xff) & 0xff
    await handle.write(byte, 0, 1, offset)
  } finally {
    await handle.close()
  }
  return destination
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}
