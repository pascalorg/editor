import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { readEnv } from '../lib/env'
import {
  assertValidName,
  DEFAULT_LIST_LIMIT,
  editorUrlForScene,
  hashGraphJson,
  parseGraph,
  resolveMaxSceneBytes,
  serializeGraph,
} from './scene-store-shared'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import {
  type ProjectCreateOptions,
  type ProjectStatus,
  type SceneEvent,
  type SceneEventAppendOptions,
  type SceneEventListOptions,
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

export interface MysqlSceneStoreOptions {
  /** Connection URL, e.g. `mysql://user:pass@host:3306/database`. Falls back to env. */
  url?: string
  /** Optional env override for URL and size-limit resolution. */
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
  graph_hash: string
}

interface SceneRowWithGraph extends SceneRow {
  graph_json: string
}

interface SceneEventRow {
  event_id: number
  scene_id: string
  version: number
  kind: string
  created_at: string
  graph_json: string
}

interface ProjectPlaceholder {
  id: string
  name: string
  ownerId: string | null
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
}

/** The slice of `mysql2/promise` this store uses, so the driver stays a dynamic import. */
interface MysqlQueryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
}

interface MysqlConnection extends MysqlQueryable {
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

interface MysqlPool extends MysqlQueryable {
  getConnection(): Promise<MysqlConnection>
  end(): Promise<void>
}

const SCENE_COLUMNS =
  'id, name, project_id, owner_id, thumbnail_url, version, created_at, updated_at, size_bytes, node_count, graph_hash'

/**
 * Reads the connection target from `DIGITALTWIN_MYSQL_URL`, or assembles one
 * from `DIGITALTWIN_MYSQL_HOST`/`_USER`/`_PASSWORD`/`_DATABASE`/`_PORT`. The
 * separate variables exist because control panels hand out those fields
 * individually, and some mangle a value containing `://` and `@`.
 *
 * A partially configured trio throws instead of returning undefined: someone
 * clearly meant to point at MySQL, and silently falling back to SQLite loses
 * their data on the next release.
 */
export function resolveMysqlUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const read = (name: string) => readEnv(env, name)

  const raw = read('MYSQL_URL')
  if (raw) return raw

  const host = read('MYSQL_HOST')
  const user = read('MYSQL_USER')
  const database = read('MYSQL_DATABASE')
  if (!host && !user && !database) return undefined
  if (!host || !user || !database) {
    const missing = [
      !host && 'DIGITALTWIN_MYSQL_HOST',
      !user && 'DIGITALTWIN_MYSQL_USER',
      !database && 'DIGITALTWIN_MYSQL_DATABASE',
    ].filter(Boolean)
    throw new SceneInvalidError(
      `Incomplete MySQL configuration: missing ${missing.join(', ')}. ` +
        'Set all of DIGITALTWIN_MYSQL_HOST, DIGITALTWIN_MYSQL_USER and ' +
        'DIGITALTWIN_MYSQL_DATABASE (plus DIGITALTWIN_MYSQL_PASSWORD/_PORT as ' +
        'needed), or a single DIGITALTWIN_MYSQL_URL.',
    )
  }

  const password = read('MYSQL_PASSWORD') ?? ''
  const port = read('MYSQL_PORT') ?? '3306'
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}

function firstRow<T>(result: unknown): T | null {
  const list = rows(result)
  return list.length > 0 ? (list[0] as T) : null
}

function rowToMeta(row: SceneRow): SceneMeta {
  const editorUrl = editorUrlForScene(row.id)
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sizeBytes: Number(row.size_bytes),
    nodeCount: Number(row.node_count),
    editorUrl,
    url: editorUrl,
    published: true,
    graphHash: row.graph_hash,
  }
}

function rowToProjectStatus(row: SceneRow): ProjectStatus {
  const editorUrl = editorUrlForScene(row.id)
  const version = Number(row.version)
  return {
    id: row.id,
    projectId: row.project_id ?? row.id,
    name: row.name,
    editorUrl,
    url: editorUrl,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    publishedVersion: version,
    latestVersion: version,
    draftVersion: null,
    browserVisibleVersion: version,
    version,
    isEmpty: Number(row.node_count) === 0,
    sizeBytes: Number(row.size_bytes),
    nodeCount: Number(row.node_count),
    graphHash: row.graph_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function placeholderToProjectStatus(project: ProjectPlaceholder): ProjectStatus {
  const editorUrl = editorUrlForScene(project.id)
  return {
    id: project.id,
    projectId: project.id,
    name: project.name,
    editorUrl,
    url: editorUrl,
    ownerId: project.ownerId,
    thumbnailUrl: project.thumbnailUrl,
    publishedVersion: null,
    latestVersion: null,
    draftVersion: null,
    browserVisibleVersion: null,
    version: 0,
    isEmpty: true,
    sizeBytes: 0,
    nodeCount: 0,
    graphHash: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function rowToSceneEvent(row: SceneEventRow): SceneEvent {
  return {
    eventId: Number(row.event_id),
    sceneId: row.scene_id,
    version: Number(row.version),
    kind: row.kind,
    createdAt: row.created_at,
    graph: parseGraph(row.graph_json, `${row.scene_id}@${row.version}`),
  }
}

/**
 * MySQL-backed implementation of `SceneStore`, for deployments where the
 * filesystem is not durable across releases.
 *
 * Timestamps are stored as ISO 8601 strings rather than DATETIME so values
 * round-trip identically to the SQLite store regardless of server timezone,
 * and `graph_hash` is persisted so listing scenes never has to pull whole
 * graph payloads over the wire.
 */
export class MysqlSceneStore implements SceneStore {
  readonly backend = 'mysql' as const

  private readonly url: string
  private readonly maxSceneBytes: number
  private pool: MysqlPool | null = null
  private poolPromise: Promise<MysqlPool> | null = null

  constructor(opts: MysqlSceneStoreOptions = {}) {
    const env = opts.env ?? process.env
    const url = opts.url ?? resolveMysqlUrl(env)
    if (!url) {
      throw new SceneInvalidError(
        'MySQL scene store requires a connection URL (DIGITALTWIN_MYSQL_URL)',
      )
    }
    this.url = url
    this.maxSceneBytes = resolveMaxSceneBytes(env, opts.maxSceneBytes)
  }

  async createProject(opts: ProjectCreateOptions): Promise<ProjectStatus> {
    const pool = await this.database()
    assertValidName(opts.name)
    const id = opts.id ? sanitizeSlug(opts.id) : await this.generateUniqueId(pool)
    if (!isValidSlug(id)) {
      throw new SceneInvalidError(`Invalid project id after sanitization: "${id}"`)
    }
    if (await this.getRow(pool, id)) {
      throw new SceneInvalidError(`Project with id "${id}" already exists`)
    }
    const now = new Date().toISOString()
    const project: ProjectPlaceholder = {
      id,
      name: opts.name,
      ownerId: opts.ownerId ?? null,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await pool.execute(
        `INSERT INTO project_placeholders (id, name, owner_id, thumbnail_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, project.name, project.ownerId, project.thumbnailUrl, now, now],
      )
    } catch (err) {
      if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
        throw new SceneInvalidError(`Project with id "${id}" already exists`)
      }
      throw err
    }
    return placeholderToProjectStatus(project)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    const pool = await this.database()
    const safeId = sanitizeSlug(id)
    const row = await this.getRow(pool, safeId)
    if (row) return rowToProjectStatus(row)
    const placeholder = await this.getPlaceholder(pool, safeId)
    return placeholder ? placeholderToProjectStatus(placeholder) : null
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    return this.withWriteTransaction(async (conn) => {
      assertValidName(opts.name)
      if (!opts.graph || typeof opts.graph !== 'object') {
        throw new SceneInvalidError('graph is required')
      }

      const providedId = opts.id
      const id = providedId ? sanitizeSlug(providedId) : await this.generateUniqueId(conn)
      if (!isValidSlug(id)) {
        throw new SceneInvalidError(`Invalid scene id after sanitization: "${id}"`)
      }

      const existing = await this.getRow(conn, id, { forUpdate: true })
      const placeholder = await this.getPlaceholder(conn, id, { forUpdate: true })

      if (existing && providedId !== undefined && opts.expectedVersion === undefined) {
        throw new SceneInvalidError(
          `Scene with id "${id}" already exists. Pass a different id or provide expectedVersion to overwrite.`,
        )
      }

      if (opts.expectedVersion !== undefined) {
        const currentVersion = existing ? Number(existing.version) : 0
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
      const version = (existing ? Number(existing.version) : 0) + 1
      const createdAt = existing?.created_at ?? placeholder?.createdAt ?? now
      const nodeCount = Object.keys(opts.graph.nodes ?? {}).length
      const projectId = opts.projectId ?? existing?.project_id ?? (placeholder ? id : null)
      const ownerId = opts.ownerId ?? existing?.owner_id ?? placeholder?.ownerId ?? null
      const thumbnailUrl =
        opts.thumbnailUrl ?? existing?.thumbnail_url ?? placeholder?.thumbnailUrl ?? null
      const graphHash = hashGraphJson(graphJson)

      if (existing) {
        await conn.execute(
          `UPDATE scenes
              SET name = ?,
                  project_id = ?,
                  owner_id = ?,
                  thumbnail_url = ?,
                  version = ?,
                  updated_at = ?,
                  size_bytes = ?,
                  node_count = ?,
                  graph_json = ?,
                  graph_hash = ?
            WHERE id = ?`,
          [
            opts.name,
            projectId,
            ownerId,
            thumbnailUrl,
            version,
            now,
            sizeBytes,
            nodeCount,
            graphJson,
            graphHash,
            id,
          ],
        )
      } else {
        await conn.execute(
          `INSERT INTO scenes (
             id, name, project_id, owner_id, thumbnail_url, version,
             created_at, updated_at, size_bytes, node_count, graph_json, graph_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            opts.name,
            projectId,
            ownerId,
            thumbnailUrl,
            version,
            createdAt,
            now,
            sizeBytes,
            nodeCount,
            graphJson,
            graphHash,
          ],
        )
      }

      await conn.execute(
        `INSERT INTO scene_revisions (
           scene_id, version, graph_json, author_kind, author_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, version, graphJson, 'mcp', ownerId, now],
      )

      await conn.execute('DELETE FROM project_placeholders WHERE id = ?', [id])

      return {
        id,
        name: opts.name,
        projectId,
        ownerId,
        thumbnailUrl,
        version,
        createdAt,
        updatedAt: now,
        sizeBytes,
        nodeCount,
        editorUrl: editorUrlForScene(id),
        url: editorUrlForScene(id),
        published: true,
        graphHash,
      }
    })
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const pool = await this.database()
    const [result] = await pool.execute(
      `SELECT ${SCENE_COLUMNS}, graph_json FROM scenes WHERE id = ?`,
      [sanitizeSlug(id)],
    )
    const row = firstRow<SceneRowWithGraph>(result)
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

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const pool = await this.database()
    // LIMIT is interpolated because the driver binds placeholders as strings,
    // which MySQL rejects there; `limit` is an integer by the check above.
    const [result] = await pool.execute(
      `SELECT ${SCENE_COLUMNS}
         FROM scenes
         ${where}
        ORDER BY updated_at DESC, id ASC
        LIMIT ${limit}`,
      bindings,
    )

    return rows(result).map((row) => rowToMeta(row as unknown as SceneRow))
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    return this.withWriteTransaction(async (conn) => {
      const safeId = sanitizeSlug(id)
      const existing = await this.getRow(conn, safeId, { forUpdate: true })
      if (!existing) return false
      if (opts.expectedVersion !== undefined && Number(existing.version) !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }
      await conn.execute('DELETE FROM scenes WHERE id = ?', [safeId])
      return true
    })
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    return this.withWriteTransaction(async (conn) => {
      assertValidName(newName)
      const safeId = sanitizeSlug(id)
      const existing = await this.getRow(conn, safeId, { forUpdate: true })
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }
      if (opts.expectedVersion !== undefined && Number(existing.version) !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }

      const now = new Date().toISOString()
      const nextVersion = Number(existing.version) + 1
      await conn.execute('UPDATE scenes SET name = ?, version = ?, updated_at = ? WHERE id = ?', [
        newName,
        nextVersion,
        now,
        safeId,
      ])

      const [graphResult] = await conn.execute('SELECT graph_json FROM scenes WHERE id = ?', [
        safeId,
      ])
      const graphRow = firstRow<{ graph_json: string }>(graphResult)
      await conn.execute(
        `INSERT INTO scene_revisions (
           scene_id, version, graph_json, author_kind, author_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [safeId, nextVersion, graphRow?.graph_json ?? '', 'mcp', existing.owner_id, now],
      )

      return {
        ...rowToMeta(existing),
        name: newName,
        version: nextVersion,
        updatedAt: now,
      }
    })
  }

  async appendSceneEvent(opts: SceneEventAppendOptions): Promise<SceneEvent> {
    return this.withWriteTransaction(async (conn) => {
      const safeId = sanitizeSlug(opts.sceneId)
      const existing = await this.getRow(conn, safeId)
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }

      const graphJson = serializeGraph(opts.graph)
      const now = new Date().toISOString()
      const [result] = await conn.execute(
        `INSERT INTO scene_events (
           scene_id, version, kind, created_at, graph_json
         ) VALUES (?, ?, ?, ?, ?)`,
        [safeId, opts.version, opts.kind, now, graphJson],
      )

      return {
        eventId: Number((result as { insertId?: number })?.insertId ?? 0),
        sceneId: safeId,
        version: opts.version,
        kind: opts.kind,
        createdAt: now,
        graph: opts.graph as SceneGraph,
      }
    })
  }

  async listSceneEvents(sceneId: string, opts: SceneEventListOptions = {}): Promise<SceneEvent[]> {
    const afterEventId = Math.max(0, opts.afterEventId ?? 0)
    const requestedLimit = opts.limit ?? 100
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100
    const pool = await this.database()
    const [result] = await pool.execute(
      `SELECT event_id, scene_id, version, kind, created_at, graph_json
         FROM scene_events
        WHERE scene_id = ?
          AND event_id > ?
        ORDER BY event_id ASC
        LIMIT ${limit}`,
      [sanitizeSlug(sceneId), afterEventId],
    )

    return rows(result).map((row) => rowToSceneEvent(row as unknown as SceneEventRow))
  }

  async close(): Promise<void> {
    await this.pool?.end()
    this.pool = null
    this.poolPromise = null
  }

  private async database(): Promise<MysqlPool> {
    if (this.pool) return this.pool
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        const mod = (await import('mysql2/promise')) as unknown as {
          createPool: (config: { uri: string; connectionLimit: number }) => MysqlPool
        }
        const pool = mod.createPool({ uri: this.url, connectionLimit: 5 })
        try {
          await this.migrate(pool)
        } catch (err) {
          // Don't cache the failure: a database that was briefly unreachable
          // at boot would otherwise poison the store until the process
          // restarts. Drop the pool and let the next call retry.
          this.poolPromise = null
          await pool.end().catch(() => {})
          throw err
        }
        this.pool = pool
        return pool
      })()
    }
    return this.poolPromise
  }

  private async migrate(pool: MysqlPool): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scenes (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        project_id VARCHAR(200) NULL,
        owner_id VARCHAR(64) NULL,
        thumbnail_url TEXT NULL,
        version INT UNSIGNED NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        updated_at VARCHAR(32) NOT NULL,
        size_bytes INT UNSIGNED NOT NULL,
        node_count INT UNSIGNED NOT NULL,
        graph_json LONGTEXT NOT NULL,
        graph_hash CHAR(64) NOT NULL,
        -- project_id is indexed by prefix: servers still defaulting to the
        -- COMPACT row format cap an index key at 767 bytes, and the whole
        -- column is 800 under utf8mb4.
        INDEX scenes_project_updated_idx (project_id(150), updated_at),
        INDEX scenes_owner_updated_idx (owner_id, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scene_revisions (
        scene_id VARCHAR(64) NOT NULL,
        version INT UNSIGNED NOT NULL,
        graph_json LONGTEXT NOT NULL,
        author_kind VARCHAR(32) NOT NULL,
        author_id VARCHAR(64) NULL,
        created_at VARCHAR(32) NOT NULL,
        PRIMARY KEY (scene_id, version),
        CONSTRAINT scene_revisions_scene_fk FOREIGN KEY (scene_id)
          REFERENCES scenes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_placeholders (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        owner_id VARCHAR(64) NULL,
        thumbnail_url TEXT NULL,
        created_at VARCHAR(32) NOT NULL,
        updated_at VARCHAR(32) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scene_events (
        event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        scene_id VARCHAR(64) NOT NULL,
        version INT UNSIGNED NOT NULL,
        kind VARCHAR(64) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        graph_json LONGTEXT NOT NULL,
        INDEX scene_events_scene_event_idx (scene_id, event_id),
        CONSTRAINT scene_events_scene_fk FOREIGN KEY (scene_id)
          REFERENCES scenes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  private async withWriteTransaction<T>(fn: (conn: MysqlConnection) => Promise<T>): Promise<T> {
    const pool = await this.database()
    const conn = await pool.getConnection()
    await conn.beginTransaction()
    try {
      const result = await fn(conn)
      await conn.commit()
      return result
    } catch (err) {
      try {
        await conn.rollback()
      } catch {
        // Ignore rollback errors so the original failure is preserved.
      }
      throw err
    } finally {
      conn.release()
    }
  }

  private async getPlaceholder(
    queryable: MysqlQueryable,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<ProjectPlaceholder | null> {
    const [result] = await queryable.execute(
      `SELECT id, name, owner_id, thumbnail_url, created_at, updated_at
         FROM project_placeholders WHERE id = ?${opts.forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    )
    const row = firstRow<{
      id: string
      name: string
      owner_id: string | null
      thumbnail_url: string | null
      created_at: string
      updated_at: string
    }>(result)
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      thumbnailUrl: row.thumbnail_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async getRow(
    queryable: MysqlQueryable,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<SceneRow | null> {
    const [result] = await queryable.execute(
      `SELECT ${SCENE_COLUMNS} FROM scenes WHERE id = ?${opts.forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    )
    return firstRow<SceneRow>(result)
  }

  private async generateUniqueId(queryable: MysqlQueryable): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateSlug()
      if (!(await this.getRow(queryable, id))) return id
    }
    throw new SceneInvalidError('Failed to generate a unique scene id')
  }
}
