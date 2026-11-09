import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { createRuntimeArchive, extractTarGzip, tarHeaderBlock } from './tar.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runtime archive', () => {
  test('writes the same bytes for the same tree regardless of timestamps', async () => {
    const root = await temporaryRoot()
    const source = path.join(root, 'runtime')
    await mkdir(path.join(source, 'apps/editor/.next'), { recursive: true })
    await writeFile(path.join(source, 'runtime-manifest.json'), '{"schemaVersion":2}')
    await writeFile(path.join(source, 'apps/editor/server.js'), 'console.log(1)\n')
    await writeFile(path.join(source, 'apps/editor/.next/build.txt'), 'build\n')
    /** Longer than the 100-byte ustar name field, so the archive needs a long-name entry. */
    const deep = path.join(source, 'apps/editor', 'a'.repeat(60), 'b'.repeat(60))
    await mkdir(deep, { recursive: true })
    await writeFile(path.join(deep, 'long-path.txt'), 'long\n')
    const executable = path.join(source, 'apps/editor/run.sh')
    await writeFile(executable, '#!/bin/sh\n')
    await chmod(executable, 0o755)

    const first = path.join(root, 'first.tar.gz')
    const firstResult = await createRuntimeArchive(source, first)
    await utimes(path.join(source, 'apps/editor/server.js'), new Date(0), new Date(0))
    const second = path.join(root, 'second.tar.gz')
    const secondResult = await createRuntimeArchive(source, second)

    expect(firstResult.entryCount).toBe(secondResult.entryCount)
    expect(await sha256(first)).toBe(await sha256(second))

    const target = path.join(root, 'extracted')
    await extractTarGzip(first, target)
    expect(await readFile(path.join(target, 'apps/editor/server.js'), 'utf8')).toBe(
      'console.log(1)\n',
    )
    expect(
      await readFile(path.join(target, deep.slice(source.length + 1), 'long-path.txt'), 'utf8'),
    ).toBe('long\n')
    expect((await stat(path.join(target, 'apps/editor/run.sh'))).mode & 0o111).not.toBe(0)
  })

  test('refuses to archive a symbolic link', async () => {
    const root = await temporaryRoot()
    const source = path.join(root, 'runtime')
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'real.txt'), 'real\n')
    await symlink('real.txt', path.join(source, 'link.txt'))

    await expect(createRuntimeArchive(source, path.join(root, 'out.tar.gz'))).rejects.toMatchObject(
      {
        code: 'archive_failed',
      },
    )
  })
})

describe('runtime archive extraction safety', () => {
  test.each([
    ['a parent traversal', '../escaped.txt'],
    ['a nested parent traversal', 'apps/../../escaped.txt'],
    ['an absolute path', '/tmp/pascal-escaped.txt'],
    ['a Windows drive path', 'C:/pascal-escaped.txt'],
  ])('rejects %s', async (_label, name) => {
    const root = await temporaryRoot()
    const archive = path.join(root, 'malicious.tar.gz')
    await writeArchive(archive, fileEntry(name, 'escaped\n'))

    await expect(extractTarGzip(archive, path.join(root, 'target'))).rejects.toMatchObject({
      code: 'invalid_runtime_archive',
    })
    expect(await exists(path.join(root, 'escaped.txt'))).toBe(false)
    expect(await exists('/tmp/pascal-escaped.txt')).toBe(false)
  })

  test('rejects a symbolic-link entry that would point out of the target', async () => {
    const root = await temporaryRoot()
    const archive = path.join(root, 'symlink.tar.gz')
    await writeArchive(archive, [
      tarHeaderBlock({ name: 'apps/editor/escape', size: 0, mode: 0o777, typeflag: '2' }),
    ])

    await expect(extractTarGzip(archive, path.join(root, 'target'))).rejects.toMatchObject({
      code: 'invalid_runtime_archive',
    })
    expect(await exists(path.join(root, 'target/apps/editor/escape'))).toBe(false)
  })

  test('rejects a hard-link entry', async () => {
    const root = await temporaryRoot()
    const archive = path.join(root, 'hardlink.tar.gz')
    await writeArchive(archive, [
      tarHeaderBlock({ name: 'apps/editor/linked', size: 0, mode: 0o644, typeflag: '1' }),
    ])

    await expect(extractTarGzip(archive, path.join(root, 'target'))).rejects.toMatchObject({
      code: 'invalid_runtime_archive',
    })
  })

  test('rejects a header whose checksum was rewritten', async () => {
    const root = await temporaryRoot()
    const archive = path.join(root, 'tampered.tar.gz')
    const [header, ...rest] = fileEntry('apps/editor/server.js', 'console.log(1)\n')
    if (!header) throw new Error('the test archive has no header block')
    const rewritten = Buffer.from(header)
    rewritten.write('X', 0, 1, 'ascii')
    await writeArchive(archive, [rewritten, ...rest])

    await expect(extractTarGzip(archive, path.join(root, 'target'))).rejects.toMatchObject({
      code: 'invalid_runtime_archive',
    })
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-tar-test-'))
  roots.push(root)
  return root
}

function fileEntry(name: string, body: string): Buffer[] {
  const data = Buffer.from(body, 'utf8')
  const padded = Buffer.alloc(Math.ceil(data.byteLength / 512) * 512)
  data.copy(padded)
  return [tarHeaderBlock({ name, size: data.byteLength, mode: 0o644, typeflag: '0' }), padded]
}

async function writeArchive(file: string, blocks: Buffer[]): Promise<void> {
  await pipeline(
    Readable.from([Buffer.concat([...blocks, Buffer.alloc(1024)])]),
    createGzip(),
    createWriteStream(file),
  )
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}
