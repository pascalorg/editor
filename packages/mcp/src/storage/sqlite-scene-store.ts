import { mkdirSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { z } from 'zod'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-driver'
import {
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneSaveOptions,
  type SceneStore,
  SceneTooLargeError,
  SceneVersionConflictError,
  type SceneWithGraph,
} from './types'

const DEFAULT_MAX_SCENE_BYTES = 10 * 1024 * 1024
const DEFAULT_LIST_LIMIT = 100
const MAX_NAME_LENGTH = 200
const MIN_NAME_LENGTH = 1

export interface SqliteSceneStoreOptions {
  /** Exact SQLite database file path. If omitted, resolved from env. */
  databasePath?: string
  /** Optional env override for default path and size-limit resolution. */
  env?: NodeJS.ProcessEnv
  /** Maximum UTF-8 byte length of graph JSON. Defaults to 10 MB. */
  maxSceneBytes?: number
}

interface SceneRow {
  id: string
  name: string
  project_id: string | null
  owner_id: string | null
  thumbnail_url: string | null
  version: number
  created_at: string
  updated_at: string
  size_bytes: number
  node_count: number
  graph_json: string
}

const GraphSchema = z.object({
  nodes: z.record(z.string(), z.unknown()),
  rootNodeIds: z.array(z.string()),
  collections: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Resolves Pascal's local SQLite database path.
 *
 * Precedence:
 * 1. `PASCAL_DB_PATH`
 * 2. `PASCAL_DATA_DIR/pascal.db`
 * 3. On Windows: `%APPDATA%/Pascal/data/pascal.db`
 * 4. `$XDG_DATA_HOME/pascal/data/pascal.db`
 * 5. `$HOME/.pascal/data/pascal.db`
 */
export function resolveDefaultDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PASCAL_DB_PATH && env.PASCAL_DB_PATH.length > 0) {
    return env.PASCAL_DB_PATH
  }
  if (env.PASCAL_DATA_DIR && env.PASCAL_DATA_DIR.length > 0) {
    return path.join(env.PASCAL_DATA_DIR, 'pascal.db')
  }
  if (process.platform === 'win32') {
    const appData = env.APPDATA
    if (appData && appData.length > 0) {
      return path.join(appData, 'Pascal', 'data', 'pascal.db')
    }
    return path.join(os.homedir(), '.pascal', 'data', 'pascal.db')
  }
  const xdg = env.XDG_DATA_HOME
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'pascal', 'data', 'pascal.db')
  }
  return path.join(os.homedir(), '.pascal', 'data', 'pascal.db')
}

function resolveMaxSceneBytes(
  env: NodeJS.ProcessEnv | undefined,
  explicit: number | undefined,
): number {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) {
      throw new SceneInvalidError('maxSceneBytes must be a positive integer')
    }
    return explicit
  }

  const raw = env?.PASCAL_MAX_SCENE_BYTES
  if (raw === undefined || raw === '') return DEFAULT_MAX_SCENE_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SceneInvalidError('PASCAL_MAX_SCENE_BYTES must be a positive integer')
  }
  return parsed
}

function rowToMeta(row: SceneRow): SceneMeta {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sizeBytes: row.size_bytes,
    nodeCount: row.node_count,
  }
}

function assertValidName(name: string): void {
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

function serializeGraph(graph: SceneGraph): string {
  return JSON.stringify(graph)
}

function parseGraph(raw: string, context: string): SceneGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new SceneInvalidError(
      `Failed to parse scene graph for ${context}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = GraphSchema.safeParse(parsed)
  if (!result.success) {
    throw new SceneInvalidError(`Scene graph for ${context} has invalid shape: ${result.error}`)
  }

  const graph = result.data
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new SceneInvalidError(`Scene graph for ${context} has non-object node at "${nodeId}"`)
    }
    const typeField = (node as { type?: unknown }).type
    if (typeof typeField !== 'string' || typeField.length === 0) {
      throw new SceneInvalidError(
        `Scene graph for ${context} has node "${nodeId}" missing a string "type"`,
      )
    }
  }

  return graph as SceneGraph
}

function asSceneRow(value: unknown): SceneRow | null {
  if (!value || typeof value !== 'object') return null
  return value as SceneRow
}

/**
 * SQLite-backed implementation of `SceneStore`.
 *
 * Uses one local database file, WAL mode, and transaction-scoped version checks
 * so a local editor and MCP process can safely share scenes on one machine.
 */
export class SqliteSceneStore implements SceneStore {
  readonly backend = 'sqlite' as const

  readonly databasePath: string

  private readonly maxSceneBytes: number
  private db: SqliteDatabase | null = null
  private dbPromise: Promise<SqliteDatabase> | null = null

  constructor(opts: SqliteSceneStoreOptions = {}) {
    const env = opts.env ?? process.env
    this.databasePath = path.resolve(opts.databasePath ?? resolveDefaultDatabasePath(env))
    this.maxSceneBytes = resolveMaxSceneBytes(env, opts.maxSceneBytes)
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    return this.withWriteTransaction((db) => {
      assertValidName(opts.name)
      if (!opts.graph || typeof opts.graph !== 'object') {
        throw new SceneInvalidError('graph is required')
      }

      const providedId = opts.id
      const id = providedId ? sanitizeSlug(providedId) : this.generateUniqueId(db)
      if (!isValidSlug(id)) {
        throw new SceneInvalidError(`Invalid scene id after sanitization: "${id}"`)
      }

      const existing = this.getRow(db, id)

      if (existing && providedId !== undefined && opts.expectedVersion === undefined) {
        throw new SceneInvalidError(
          `Scene with id "${id}" already exists. Pass a different id or provide expectedVersion to overwrite.`,
        )
      }

      if (opts.expectedVersion !== undefined) {
        const currentVersion = existing?.version ?? 0
        if (currentVersion !== opts.expectedVersion) {
          throw new SceneVersionConflictError(
            `Scene "${id}" version mismatch: expected ${opts.expectedVersion}, got ${currentVersion}`,
          )
        }
      }

      const graphJson = serializeGraph(opts.graph)
      const sizeBytes = Buffer.byteLength(graphJson, 'utf8')
      if (sizeBytes > this.maxSceneBytes) {
        throw new SceneTooLargeError(
          `Scene "${id}" is ${sizeBytes} bytes, exceeds cap of ${this.maxSceneBytes} bytes`,
        )
      }

      const now = new Date().toISOString()
      const version = (existing?.version ?? 0) + 1
      const createdAt = existing?.created_at ?? now
      const nodeCount = Object.keys(opts.graph.nodes ?? {}).length

      if (existing) {
        db.query(
          `UPDATE scenes
             SET name = ?,
                 project_id = ?,
                 owner_id = ?,
                 thumbnail_url = ?,
                 version = ?,
                 updated_at = ?,
                 size_bytes = ?,
                 node_count = ?,
                 graph_json = ?
           WHERE id = ?`,
        ).run(
          opts.name,
          opts.projectId ?? null,
          opts.ownerId ?? null,
          opts.thumbnailUrl ?? null,
          version,
          now,
          sizeBytes,
          nodeCount,
          graphJson,
          id,
        )
      } else {
        db.query(
          `INSERT INTO scenes (
             id, name, project_id, owner_id, thumbnail_url, version,
             created_at, updated_at, size_bytes, node_count, graph_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          opts.name,
          opts.projectId ?? null,
          opts.ownerId ?? null,
          opts.thumbnailUrl ?? null,
          version,
          createdAt,
          now,
          sizeBytes,
          nodeCount,
          graphJson,
        )
      }

      db.query(
        `INSERT INTO scene_revisions (
           scene_id, version, graph_json, author_kind, author_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, version, graphJson, 'mcp', opts.ownerId ?? null, now)

      return {
        id,
        name: opts.name,
        projectId: opts.projectId ?? null,
        ownerId: opts.ownerId ?? null,
        thumbnailUrl: opts.thumbnailUrl ?? null,
        version,
        createdAt,
        updatedAt: now,
        sizeBytes,
        nodeCount,
      }
    })
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const db = await this.database()
    const row = this.getRow(db, sanitizeSlug(id))
    if (!row) return null
    return {
      ...rowToMeta(row),
      graph: parseGraph(row.graph_json, row.id),
    }
  }

  async list(opts: SceneListOptions = {}): Promise<SceneMeta[]> {
    const clauses: string[] = []
    const bindings: Array<string | number> = []

    if (opts.projectId !== undefined) {
      clauses.push('project_id = ?')
      bindings.push(opts.projectId)
    }
    if (opts.ownerId !== undefined) {
      clauses.push('owner_id = ?')
      bindings.push(opts.ownerId)
    }

    const requestedLimit = opts.limit ?? DEFAULT_LIST_LIMIT
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 0 ? requestedLimit : 0
    bindings.push(limit)

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const db = await this.database()
    const rows = db
      .query(
        `SELECT id, name, project_id, owner_id, thumbnail_url, version,
                created_at, updated_at, size_bytes, node_count, graph_json
           FROM scenes
           ${where}
          ORDER BY updated_at DESC, id ASC
          LIMIT ?`,
      )
      .all(...bindings)

    return rows.map((row) => rowToMeta(row as SceneRow))
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    return this.withWriteTransaction((db) => {
      const safeId = sanitizeSlug(id)
      const existing = this.getRow(db, safeId)
      if (!existing) return false
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }
      db.query('DELETE FROM scenes WHERE id = ?').run(safeId)
      return true
    })
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    return this.withWriteTransaction((db) => {
      assertValidName(newName)
      const safeId = sanitizeSlug(id)
      const existing = this.getRow(db, safeId)
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }

      const now = new Date().toISOString()
      const nextVersion = existing.version + 1
      db.query('UPDATE scenes SET name = ?, version = ?, updated_at = ? WHERE id = ?').run(
        newName,
        nextVersion,
        now,
        safeId,
      )

      db.query(
        `INSERT INTO scene_revisions (
             scene_id, version, graph_json, author_kind, author_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(safeId, nextVersion, existing.graph_json, 'mcp', existing.owner_id, now)

      return {
        ...rowToMeta(existing),
        name: newName,
        version: nextVersion,
        updatedAt: now,
      }
    })
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.dbPromise = null
  }

  private async database(): Promise<SqliteDatabase> {
    if (this.db) return this.db
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        mkdirSync(path.dirname(this.databasePath), { recursive: true })
        const db = await openSqliteDatabase(this.databasePath)
        db.exec('PRAGMA foreign_keys = ON')
        db.exec('PRAGMA journal_mode = WAL')
        db.exec('PRAGMA busy_timeout = 5000')
        this.migrate(db)
        this.db = db
        return db
      })()
    }
    return this.dbPromise
  }

  private migrate(db: SqliteDatabase): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 200),
        project_id TEXT,
        owner_id TEXT,
        thumbnail_url TEXT,
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        node_count INTEGER NOT NULL CHECK (node_count >= 0),
        graph_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS scenes_project_updated_idx
        ON scenes(project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS scenes_owner_updated_idx
        ON scenes(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS scene_revisions (
        scene_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        graph_json TEXT NOT NULL,
        author_kind TEXT NOT NULL,
        author_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scene_id, version),
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );
    `)
  }

  private async withWriteTransaction<T>(fn: (db: SqliteDatabase) => T | Promise<T>): Promise<T> {
    const db = await this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(db)
      db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors so the original failure is preserved.
      }
      throw err
    }
  }

  private getRow(db: SqliteDatabase, id: string): SceneRow | null {
    return asSceneRow(
      db
        .query(
          `SELECT id, name, project_id, owner_id, thumbnail_url, version,
                  created_at, updated_at, size_bytes, node_count, graph_json
             FROM scenes
            WHERE id = ?`,
        )
        .get(id),
    )
  }

  private generateUniqueId(db: SqliteDatabase): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateSlug()
      if (!this.getRow(db, id)) return id
    }
    throw new SceneInvalidError('Failed to generate a unique scene id')
  }
}
