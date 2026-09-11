import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { CliError } from './errors.js'

const BLOCK_SIZE = 512
const LONG_NAME_ENTRY = '././@LongLink'

export interface TarHeaderFields {
  name: string
  size: number
  mode: number
  typeflag: string
}

export interface RuntimeArchiveResult {
  size: number
  entryCount: number
}

interface ArchiveEntry {
  relative: string
  absolute: string
  directory: boolean
  size: number
  mode: number
}

/**
 * Writes a byte-for-byte reproducible tar.gz: entries sorted by path, zero mtime, zero
 * uid/gid, empty owner names and normalized modes. Two runs over the same tree therefore
 * produce the same SHA-256, which is what `dist/runtime-source.json` pins.
 */
export async function createRuntimeArchive(
  sourceDirectory: string,
  destinationFile: string,
): Promise<RuntimeArchiveResult> {
  const root = path.resolve(sourceDirectory)
  const destination = path.resolve(destinationFile)
  const entries = await collectEntries(root)
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(destination, { force: true })
  await pipeline(
    Readable.from(archiveBlocks(entries), { objectMode: false }),
    createGzip({ level: 9 }),
    createWriteStream(destination),
  )
  return { size: (await stat(destination)).size, entryCount: entries.length }
}

export async function extractTarGzip(archiveFile: string, targetDirectory: string): Promise<void> {
  const root = path.resolve(targetDirectory)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const source = createReadStream(archiveFile)
  const gunzip = createGunzip()
  source.on('error', (error) => gunzip.destroy(error))
  const reader = new BlockReader(source.pipe(gunzip))
  let pendingLongName: string | null = null
  try {
    for (;;) {
      const header = await reader.read(BLOCK_SIZE)
      if (!header || isZeroBlock(header)) break
      verifyChecksum(header)
      const typeflag = String.fromCharCode(header[156] ?? 0)
      const size = readOctal(header, 124, 12)
      const mode = readOctal(header, 100, 8)
      if (typeflag === 'L') {
        const data = await reader.read(paddedSize(size))
        if (!data) throw invalidArchive('a long-name entry is truncated')
        pendingLongName = data.subarray(0, size).toString('utf8').replace(/\0+$/, '')
        continue
      }
      const name = pendingLongName ?? readHeaderString(header, 0, 100)
      pendingLongName = null
      if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '5') {
        throw invalidArchive(`entry ${JSON.stringify(name)} uses unsupported type "${typeflag}"`)
      }
      const destination = resolveEntryPath(root, name)
      if (typeflag === '5') {
        await mkdir(destination, { recursive: true, mode: 0o755 })
        continue
      }
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 })
      await reader.writeTo(
        createWriteStream(destination, { mode: (mode & 0o111) !== 0 ? 0o755 : 0o644 }),
        size,
      )
      const padding = paddedSize(size) - size
      if (padding > 0 && !(await reader.read(padding))) {
        throw invalidArchive(`entry ${JSON.stringify(name)} is truncated`)
      }
    }
  } finally {
    gunzip.destroy()
    source.destroy()
  }
}

export function tarHeaderBlock(fields: TarHeaderFields): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE)
  Buffer.from(fields.name, 'utf8').subarray(0, 100).copy(block, 0)
  writeOctal(block, fields.mode & 0o7777, 100, 8)
  writeOctal(block, 0, 108, 8)
  writeOctal(block, 0, 116, 8)
  writeOctal(block, fields.size, 124, 12)
  writeOctal(block, 0, 136, 12)
  block.write(fields.typeflag, 156, 1, 'ascii')
  block.write('ustar\0', 257, 6, 'ascii')
  block.write('00', 263, 2, 'ascii')
  block.fill(0x20, 148, 156)
  let checksum = 0
  for (const byte of block) checksum += byte
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return block
}

async function* archiveBlocks(entries: ArchiveEntry[]): AsyncGenerator<Buffer> {
  for (const entry of entries) {
    const name = entry.directory ? `${entry.relative}/` : entry.relative
    const nameBytes = Buffer.from(name, 'utf8')
    if (nameBytes.byteLength > 100) {
      yield tarHeaderBlock({
        name: LONG_NAME_ENTRY,
        size: nameBytes.byteLength + 1,
        mode: 0o644,
        typeflag: 'L',
      })
      const data = Buffer.concat([nameBytes, Buffer.of(0)])
      yield data
      yield* paddingBlocks(data.byteLength)
    }
    yield tarHeaderBlock({
      name,
      size: entry.directory ? 0 : entry.size,
      mode: entry.mode,
      typeflag: entry.directory ? '5' : '0',
    })
    if (entry.directory) continue
    let written = 0
    for await (const chunk of createReadStream(entry.absolute)) {
      const buffer = chunk as Buffer
      written += buffer.byteLength
      yield buffer
    }
    if (written !== entry.size) {
      throw new CliError(
        'archive_failed',
        `${entry.relative} changed size while the archive was being written.`,
      )
    }
    yield* paddingBlocks(written)
  }
  yield Buffer.alloc(2 * BLOCK_SIZE)
}

function* paddingBlocks(size: number): Generator<Buffer> {
  const padding = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE
  if (padding > 0) yield Buffer.alloc(padding)
}

async function collectEntries(root: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, child.name)
      const relative = prefix ? `${prefix}/${child.name}` : child.name
      if (child.isSymbolicLink()) {
        throw new CliError('archive_failed', `Cannot archive the symbolic link ${relative}.`)
      }
      if (child.isDirectory()) {
        entries.push({ relative, absolute, directory: true, size: 0, mode: 0o755 })
        await walk(absolute, relative)
        continue
      }
      if (!child.isFile()) {
        throw new CliError('archive_failed', `Cannot archive the special file ${relative}.`)
      }
      const info = await stat(absolute)
      entries.push({
        relative,
        absolute,
        directory: false,
        size: info.size,
        mode: (info.mode & 0o111) !== 0 ? 0o755 : 0o644,
      })
    }
  }
  await walk(root, '')
  return entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relative, 'utf8'), Buffer.from(right.relative, 'utf8')),
  )
}

class BlockReader {
  private readonly iterator: AsyncIterator<Buffer>
  private pending: Buffer = Buffer.alloc(0)

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>
  }

  async read(size: number): Promise<Buffer | null> {
    if (size === 0) return Buffer.alloc(0)
    while (this.pending.byteLength < size) {
      const next = await this.iterator.next()
      if (next.done) break
      this.pending =
        this.pending.byteLength === 0
          ? Buffer.from(next.value)
          : Buffer.concat([this.pending, next.value])
    }
    if (this.pending.byteLength < size) return null
    const result = this.pending.subarray(0, size)
    this.pending = this.pending.subarray(size)
    return result
  }

  async writeTo(target: Writable, size: number): Promise<void> {
    let remaining = size
    try {
      while (remaining > 0) {
        const chunk = await this.read(Math.min(remaining, 1024 * 1024))
        if (!chunk) throw invalidArchive('an entry ends before its recorded size')
        remaining -= chunk.byteLength
        if (!target.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            target.once('drain', resolve)
            target.once('error', reject)
          })
        }
      }
    } catch (error) {
      target.destroy()
      throw error
    }
    await new Promise<void>((resolve, reject) => {
      target.once('error', reject)
      target.end(resolve)
    })
  }
}

function resolveEntryPath(root: string, name: string): string {
  const normalized = name.replace(/\/+$/, '')
  const segments = normalized.split('/')
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some((segment) => segment === '..' || segment === '')
  ) {
    throw invalidArchive(`entry ${JSON.stringify(name)} is not a safe relative path`)
  }
  const destination = path.resolve(root, ...segments)
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw invalidArchive(`entry ${JSON.stringify(name)} escapes the extraction directory`)
  }
  return destination
}

function verifyChecksum(header: Buffer): void {
  const expected = readOctal(header, 148, 8)
  let checksum = 0
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0)
  }
  if (checksum !== expected) throw invalidArchive('an entry header checksum does not match')
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0)
}

function paddedSize(size: number): number {
  return size + ((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE)
}

function readHeaderString(block: Buffer, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.byteLength : end).toString('utf8')
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readHeaderString(block, offset, length).trim()
  if (!/^[0-7]*$/.test(text)) throw invalidArchive('an entry header field is not octal')
  return text ? Number.parseInt(text, 8) : 0
}

function writeOctal(block: Buffer, value: number, offset: number, length: number): void {
  block.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii')
}

function invalidArchive(reason: string): CliError {
  return new CliError(
    'invalid_runtime_archive',
    `The Pascal web runtime archive is invalid: ${reason}.`,
  )
}
