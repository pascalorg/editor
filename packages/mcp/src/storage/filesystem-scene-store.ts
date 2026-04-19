import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import {
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  type SceneSaveOptions,
  type SceneStore,
  SceneTooLargeError,
  SceneVersionConflictError,
  type SceneWithGraph,
} from './types'

const MAX_SCENE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_NAME_LENGTH = 200
const MIN_NAME_LENGTH = 1
const SCENES_SUBDIR = 'scenes'
const INDEX_FILE = '.index.json'
const TMP_SUFFIX = '.tmp'

/**
 * Options for constructing a `FilesystemSceneStore`.
 */
export interface FilesystemSceneStoreOptions {
  /** Root directory for scene storage. If omitted, resolved from env. */
  rootDir?: string
  /** Optional env override for default root resolution. */
  env?: NodeJS.ProcessEnv
}

/**
 * Resolves the default root directory for on-disk scene storage.
 *
 * Precedence:
 * 1. `PASCAL_DATA_DIR`
 * 2. On Windows: `%APPDATA%/Pascal/data`
 * 3. `$XDG_DATA_HOME/pascal/data`
 * 4. `$HOME/.pascal/data`
 */
export function resolveDefaultRootDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PASCAL_DATA_DIR && env.PASCAL_DATA_DIR.length > 0) {
    return env.PASCAL_DATA_DIR
  }
  if (process.platform === 'win32') {
    const appData = env.APPDATA
    if (appData && appData.length > 0) {
      return path.join(appData, 'Pascal', 'data')
    }
    return path.join(os.homedir(), '.pascal', 'data')
  }
  const xdg = env.XDG_DATA_HOME
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'pascal', 'data')
  }
  return path.join(os.homedir(), '.pascal', 'data')
}

/**
 * Zod schema used to validate the top-level envelope of a persisted scene file.
 * Kept intentionally lax — we validate `meta` fields inline and each node's shape
 * via `Object.keys` length + per-node shape checks for performance.
 */
const PersistedSceneSchema = z.object({
  meta: z.object({
    id: z.string(),
    name: z.string(),
    projectId: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    version: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
    ownerId: z.string().nullable(),
    sizeBytes: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
  }),
  graph: z.object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.record(z.string(), z.unknown()).optional(),
  }),
})

type PersistedScene = z.infer<typeof PersistedSceneSchema>

/**
 * File-backed implementation of `SceneStore`.
 *
 * Persists each scene as `<root>/scenes/<id>.json` with an optional sidecar
 * index file `<root>/scenes/.index.json` for fast listing.
 *
 * Writes are atomic via tmp file + rename. Saves bump `meta.version` by 1 and
 * honor `expectedVersion` for optimistic concurrency control. Reads return
 * `null` for missing files and throw `SceneInvalidError` when a file on disk
 * has become corrupt.
 */
export class FilesystemSceneStore implements SceneStore {
  readonly backend = 'filesystem' as const

  private readonly rootDir: string
  private readonly scenesDir: string
  private readonly indexPath: string

  constructor(opts: FilesystemSceneStoreOptions = {}) {
    const root = opts.rootDir ?? resolveDefaultRootDir(opts.env ?? process.env)
    this.rootDir = path.resolve(root)
    this.scenesDir = path.join(this.rootDir, SCENES_SUBDIR)
    this.indexPath = path.join(this.scenesDir, INDEX_FILE)
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    this.assertValidName(opts.name)

    const providedId = opts.id
    const id = providedId ? sanitizeSlug(providedId) : generateSlug()
    if (!isValidSlug(id)) {
      throw new SceneInvalidError(`Invalid scene id after sanitization: "${id}"`)
    }

    await this.ensureScenesDir()

    const finalPath = this.scenePath(id)
    const existing = await this.readPersisted(id)

    // Slug collision check: only when caller passed an explicit id
    // and `expectedVersion` is NOT provided (i.e. this is treated as a create).
    if (existing && providedId !== undefined && opts.expectedVersion === undefined) {
      throw new SceneInvalidError(
        `Scene with id "${id}" already exists. Pass a different id or provide expectedVersion to overwrite.`,
      )
    }

    // Optimistic concurrency
    if (opts.expectedVersion !== undefined) {
      const currentVersion = existing?.meta.version ?? 0
      if (currentVersion !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${id}" version mismatch: expected ${opts.expectedVersion}, got ${currentVersion}`,
        )
      }
    }

    const now = new Date().toISOString()
    const createdAt = existing?.meta.createdAt ?? now
    const nextVersion = (existing?.meta.version ?? 0) + 1
    const nodeCount = Object.keys(opts.graph.nodes).length

    // Assemble meta + record so we can measure the final serialized size.
    // sizeBytes is filled in after we know the encoded length.
    const meta: SceneMeta = {
      id,
      name: opts.name,
      projectId: opts.projectId ?? null,
      thumbnailUrl: opts.thumbnailUrl ?? null,
      version: nextVersion,
      createdAt,
      updatedAt: now,
      ownerId: opts.ownerId ?? null,
      sizeBytes: 0,
      nodeCount,
    }

    const record: PersistedScene = { meta, graph: opts.graph as PersistedScene['graph'] }
    // Iterate until sizeBytes is stable: encoding the size changes the
    // resulting byte count if the digit width shifts, so fixed-point it.
    let json = this.serialize(record)
    let sizeBytes = Buffer.byteLength(json, 'utf8')
    // Fixed-point loop, bounded to avoid infinite cycles on pathological inputs.
    for (let guard = 0; guard < 5; guard++) {
      meta.sizeBytes = sizeBytes
      record.meta = meta
      const next = this.serialize(record)
      const nextSize = Buffer.byteLength(next, 'utf8')
      if (nextSize === sizeBytes) {
        json = next
        break
      }
      json = next
      sizeBytes = nextSize
    }

    if (sizeBytes > MAX_SCENE_BYTES) {
      throw new SceneTooLargeError(
        `Scene "${id}" is ${sizeBytes} bytes, exceeds cap of ${MAX_SCENE_BYTES} bytes`,
      )
    }

    await this.atomicWrite(finalPath, json)
    await this.writeIndex(await this.collectAllMeta())
    return meta
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const safeId = sanitizeSlug(id)
    const record = await this.readPersisted(safeId)
    if (!record) return null
    return { ...record.meta, graph: record.graph as SceneWithGraph['graph'] }
  }

  async list(opts: SceneListOptions = {}): Promise<SceneMeta[]> {
    const metas = (await this.readIndex()) ?? (await this.collectAllMeta())
    let filtered = metas
    if (opts.projectId !== undefined) {
      filtered = filtered.filter((m) => m.projectId === opts.projectId)
    }
    if (opts.ownerId !== undefined) {
      filtered = filtered.filter((m) => m.ownerId === opts.ownerId)
    }
    filtered = filtered.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (opts.limit !== undefined && opts.limit >= 0) {
      filtered = filtered.slice(0, opts.limit)
    }
    return filtered
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    const safeId = sanitizeSlug(id)
    const existing = await this.readPersisted(safeId)
    if (!existing) return false
    if (opts.expectedVersion !== undefined && existing.meta.version !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.meta.version}`,
      )
    }
    const finalPath = this.scenePath(safeId)
    await fs.unlink(finalPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
    await this.writeIndex(await this.collectAllMeta())
    return true
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    this.assertValidName(newName)
    const safeId = sanitizeSlug(id)
    const existing = await this.readPersisted(safeId)
    if (!existing) {
      throw new SceneInvalidError(`Scene "${safeId}" not found`)
    }
    return this.save({
      id: safeId,
      name: newName,
      projectId: existing.meta.projectId,
      ownerId: existing.meta.ownerId,
      thumbnailUrl: existing.meta.thumbnailUrl,
      graph: existing.graph as SceneWithGraph['graph'],
      expectedVersion: opts.expectedVersion ?? existing.meta.version,
    })
  }

  // ---------- Internal helpers ----------

  private scenePath(id: string): string {
    return path.join(this.scenesDir, `${id}.json`)
  }

  private assertValidName(name: string): void {
    if (typeof name !== 'string') {
      throw new SceneInvalidError('Scene name must be a string')
    }
    const trimmed = name.trim()
    if (trimmed.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
      throw new SceneInvalidError(
        `Scene name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters (got ${name.length})`,
      )
    }
  }

  private serialize(record: PersistedScene): string {
    return JSON.stringify(record, null, 2)
  }

  private async ensureScenesDir(): Promise<void> {
    await fs.mkdir(this.scenesDir, { recursive: true })
  }

  private async atomicWrite(finalPath: string, contents: string): Promise<void> {
    const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TMP_SUFFIX}`
    await fs.writeFile(tmpPath, contents, { encoding: 'utf8', flag: 'w' })
    try {
      await fs.rename(tmpPath, finalPath)
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      throw err
    }
  }

  private async readPersisted(id: string): Promise<PersistedScene | null> {
    const filePath = this.scenePath(id)
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return null
      throw err
    }
    return this.parseRecord(raw, filePath)
  }

  private parseRecord(raw: string, filePath: string): PersistedScene {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new SceneInvalidError(
        `Failed to parse scene file ${filePath}: ${(err as Error).message}`,
      )
    }
    const result = PersistedSceneSchema.safeParse(parsed)
    if (!result.success) {
      throw new SceneInvalidError(
        `Scene file ${filePath} has invalid shape: ${result.error.message}`,
      )
    }
    const record = result.data
    // Validate individual node envelopes: every value in `nodes` must be a
    // non-null object with a `type` string. We don't fully parse each node via
    // core's AnyNode because it's expensive and the schemas evolve; the lift
    // is to catch egregious corruption early.
    for (const [nodeId, node] of Object.entries(record.graph.nodes)) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new SceneInvalidError(`Scene file ${filePath} has non-object node at "${nodeId}"`)
      }
      const typeField = (node as { type?: unknown }).type
      if (typeof typeField !== 'string' || typeField.length === 0) {
        throw new SceneInvalidError(
          `Scene file ${filePath} has node "${nodeId}" missing a string "type"`,
        )
      }
    }
    return record
  }

  private async readIndex(): Promise<SceneMeta[] | null> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      // Trust the index — it was written by us — but filter out any entries
      // whose underlying file has since vanished.
      const valid: SceneMeta[] = []
      for (const entry of parsed as SceneMeta[]) {
        if (!entry || typeof entry.id !== 'string') continue
        const exists = await fs
          .access(this.scenePath(entry.id), fsConstants.F_OK)
          .then(() => true)
          .catch(() => false)
        if (exists) valid.push(entry)
      }
      return valid
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return null
      return null
    }
  }

  private async collectAllMeta(): Promise<SceneMeta[]> {
    try {
      const entries = await fs.readdir(this.scenesDir)
      const metas: SceneMeta[] = []
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        if (entry === INDEX_FILE) continue
        if (entry.endsWith(TMP_SUFFIX)) continue
        const id = entry.slice(0, -'.json'.length)
        const record = await this.readPersisted(id).catch(() => null)
        if (record) metas.push(record.meta)
      }
      return metas
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return []
      throw err
    }
  }

  private async writeIndex(metas: SceneMeta[]): Promise<void> {
    await this.ensureScenesDir()
    const sorted = metas.slice().sort((a, b) => a.id.localeCompare(b.id))
    await this.atomicWrite(this.indexPath, `${JSON.stringify(sorted, null, 2)}\n`)
  }
}
