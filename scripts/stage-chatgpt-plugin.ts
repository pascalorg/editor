import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'
import { chatGptPackageEntries, type PackageEntry } from './chatgpt-plugin-package'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'chatgpt-plugin')
const entries = chatGptPackageEntries(root)

rmSync(out, { recursive: true, force: true })
for (const { path, source } of entries) {
  mkdirSync(dirname(join(out, path)), { recursive: true })
  cpSync(source, join(out, path))
}

/** A deflate ZIP of the entries, for machines without the `zip` executable. */
function zipEntries(files: readonly PackageEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const { path, source } of files) {
    const name = Buffer.from(path, 'utf8')
    const data = readFileSync(source)
    const deflated = deflateRawSync(data)
    const checksum = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(8, 8)
    header.writeUInt16LE(0x21, 12) // 1980-01-01, so identical inputs give identical bytes
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(deflated.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, deflated)

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(8, 10)
    record.writeUInt16LE(0x21, 14)
    record.writeUInt32LE(checksum, 16)
    record.writeUInt32LE(deflated.length, 20)
    record.writeUInt32LE(data.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += header.length + name.length + deflated.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

const { version } = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')) as {
  version: string
}
const zip = join(root, 'dist', `pascal-agent-skills-${version}-chatgpt.zip`)
rmSync(zip, { force: true })
if (Bun.which('zip')) {
  const zipped = Bun.spawnSync(['zip', '-qrX', zip, '.'], { cwd: out })
  if (!zipped.success) throw new Error(`zip failed: ${zipped.stderr.toString()}`)
} else {
  writeFileSync(zip, zipEntries(entries))
}
console.log(`Wrote ${zip} (${entries.length} files)`)
