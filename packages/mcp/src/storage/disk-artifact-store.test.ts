import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiskArtifactStore } from '@pascal-app/mcp/storage'

test('artifacts survive reopening, verify content, and never replace an existing hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pascal-artifacts-'))
  try {
    const project = join(dir, 'house.json')
    const bytes = new TextEncoder().encode('export default function build() {}')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const first = new DiskArtifactStore(project)
    await Promise.all([first.put(sha, bytes), first.put(sha, bytes)])
    const original = await stat(join(first.directory, sha))
    const reopened = new DiskArtifactStore(project)
    expect(await reopened.read(sha)).toEqual(bytes)
    await reopened.put(sha, bytes)
    expect((await stat(join(first.directory, sha))).ino).toBe(original.ino)
    expect(await readdir(first.directory)).toEqual([sha])
    await expect(reopened.put(sha, new Uint8Array([1]))).rejects.toThrow('hash mismatch')
    await expect(reopened.read('../house.json')).rejects.toThrow('Invalid artifact hash')
    expect(await reopened.read('0'.repeat(64))).toBeNull()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
