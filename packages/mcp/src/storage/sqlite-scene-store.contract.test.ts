import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runSceneStoreContract } from './scene-store-contract.test'
import { SqliteSceneStore } from './sqlite-scene-store'

let rootDir: string | null = null

async function databasePath(): Promise<string> {
  if (!rootDir) {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-sqlite-contract-'))
  }
  return path.join(rootDir, 'pascal.db')
}

runSceneStoreContract({
  name: 'SqliteSceneStore',
  async create(options) {
    return new SqliteSceneStore({
      databasePath: await databasePath(),
      ...(options?.maxSceneBytes !== undefined ? { maxSceneBytes: options.maxSceneBytes } : {}),
    })
  },
  async reset() {
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true })
    rootDir = null
  },
  release(store) {
    ;(store as SqliteSceneStore).close()
  },
})
