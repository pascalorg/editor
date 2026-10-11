import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Immutable artifacts beside the SQLite scene database. */
export class DiskArtifactStore {
  readonly directory: string

  constructor(projectPath: string) {
    this.directory = `${resolve(projectPath)}.artifacts`
  }

  private path(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid artifact hash')
    return join(this.directory, sha256)
  }

  async put(sha256: string, bytes: ArrayBuffer | Uint8Array): Promise<void> {
    const path = this.path(sha256)
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    if (createHash('sha256').update(data).digest('hex') !== sha256) {
      throw new Error('Artifact hash mismatch')
    }
    await mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `.${randomUUID()}`)
    try {
      await writeFile(temporary, data, { flag: 'wx' })
      // A hard link publishes complete bytes atomically without replacing another writer's file.
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async read(sha256: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.path(sha256))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
