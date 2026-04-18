import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { generateSlug, sanitizeSlug } from './slug'
import {
  type SceneId,
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneSaveOptions,
  type SceneStore,
  SceneVersionConflictError,
  type SceneWithGraph,
} from './types'

const DEFAULT_LIST_LIMIT = 100
const MAX_NAME_LENGTH = 200

/**
 * Minimal structural description of the Supabase client API we use. This lets
 * the store be exercised in tests with a plain object mock and avoids a hard
 * runtime dependency on `@supabase/supabase-js` for the test suite.
 */
export interface SupabaseQueryResult<T> {
  data: T | null
  error: { message: string; code?: string; details?: string } | null
}

export interface SupabaseQueryBuilder<Row> {
  select(columns?: string): SupabaseQueryBuilder<Row>
  insert(values: Partial<Row> | Partial<Row>[]): SupabaseQueryBuilder<Row>
  update(values: Partial<Row>): SupabaseQueryBuilder<Row>
  delete(): SupabaseQueryBuilder<Row>
  upsert(values: Partial<Row> | Partial<Row>[]): SupabaseQueryBuilder<Row>
  eq(column: string, value: unknown): SupabaseQueryBuilder<Row>
  order(column: string, opts?: { ascending?: boolean }): SupabaseQueryBuilder<Row>
  limit(count: number): SupabaseQueryBuilder<Row>
  maybeSingle(): Promise<SupabaseQueryResult<Row>>
  single(): Promise<SupabaseQueryResult<Row>>
  then<TResult1 = SupabaseQueryResult<Row[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: SupabaseQueryResult<Row[]>) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2>
}

export interface SupabaseLikeClient {
  from<Row = Record<string, unknown>>(table: string): SupabaseQueryBuilder<Row>
}

export interface SupabaseSceneStoreOptions {
  url: string
  serviceRoleKey: string
  tableScenes?: string
  tableRevisions?: string
  /**
   * Injectable client, primarily for tests. When omitted, the constructor
   * will lazily import `@supabase/supabase-js` and build a real client from
   * `url` + `serviceRoleKey`.
   */
  client?: SupabaseLikeClient
}

interface SceneRow {
  id: string
  project_id: string | null
  owner_id: string | null
  name: string
  graph_json: SceneGraph
  thumbnail_url: string | null
  version: number
  public: boolean
  size_bytes: number
  node_count: number
  created_at: string
  updated_at: string
}

interface RevisionRow {
  scene_id: string
  version: number
  graph_json: SceneGraph
  author_kind: 'human' | 'mcp' | 'agent'
  author_id: string | null
  created_at: string
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

function computeSize(graph: SceneGraph): number {
  return Buffer.byteLength(JSON.stringify(graph), 'utf8')
}

function countNodes(graph: SceneGraph): number {
  return Object.keys(graph.nodes ?? {}).length
}

function validateName(name: string): void {
  if (typeof name !== 'string' || name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new SceneInvalidError(`name must be 1–${MAX_NAME_LENGTH} characters`)
  }
}

export class SupabaseSceneStore implements SceneStore {
  readonly backend = 'supabase' as const

  private readonly tableScenes: string
  private readonly tableRevisions: string
  private clientPromise: Promise<SupabaseLikeClient>

  constructor(opts: SupabaseSceneStoreOptions) {
    if (!opts.url) throw new Error('SupabaseSceneStore: url is required')
    if (!opts.serviceRoleKey) throw new Error('SupabaseSceneStore: serviceRoleKey is required')

    this.tableScenes = opts.tableScenes ?? 'scenes'
    this.tableRevisions = opts.tableRevisions ?? 'scene_revisions'

    if (opts.client) {
      const injected = opts.client
      this.clientPromise = Promise.resolve(injected)
    } else {
      // Lazy load the real client so tests that inject `client` don't need
      // `@supabase/supabase-js` installed.
      const url = opts.url
      const key = opts.serviceRoleKey
      this.clientPromise = import('@supabase/supabase-js').then((mod) =>
        mod.createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      ) as Promise<SupabaseLikeClient>
    }
  }

  private async client(): Promise<SupabaseLikeClient> {
    return this.clientPromise
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    validateName(opts.name)
    if (!opts.graph || typeof opts.graph !== 'object') {
      throw new SceneInvalidError('graph is required')
    }

    const nowIso = new Date().toISOString()
    const sizeBytes = computeSize(opts.graph)
    const nodeCount = countNodes(opts.graph)

    const client = await this.client()

    const providedId = opts.id
    const hasId = typeof providedId === 'string' && providedId.length > 0

    if (!hasId) {
      // New scene — generate a fresh slug and insert at version 1.
      const id = generateSlug()
      const inserted = await client
        .from<SceneRow>(this.tableScenes)
        .insert({
          id,
          project_id: opts.projectId ?? null,
          owner_id: opts.ownerId ?? null,
          name: opts.name,
          graph_json: opts.graph,
          thumbnail_url: opts.thumbnailUrl ?? null,
          version: 1,
          size_bytes: sizeBytes,
          node_count: nodeCount,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select()
        .single()

      if (inserted.error || !inserted.data) {
        throw new Error(`Supabase insert failed: ${inserted.error?.message ?? 'unknown error'}`)
      }

      await this.insertRevision(client, id, 1, opts.graph, opts.ownerId ?? null)
      return rowToMeta(inserted.data)
    }

    // Existing scene — upsert path.
    const id = sanitizeSlug(providedId)

    // Look up current version so we know the next value + can enforce
    // expectedVersion locally even when Supabase's RLS answer is opaque.
    const existing = await client
      .from<SceneRow>(this.tableScenes)
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (existing.error) {
      throw new Error(`Supabase lookup failed: ${existing.error.message}`)
    }

    if (!existing.data) {
      // No row yet for this id — insert as v1.
      const inserted = await client
        .from<SceneRow>(this.tableScenes)
        .insert({
          id,
          project_id: opts.projectId ?? null,
          owner_id: opts.ownerId ?? null,
          name: opts.name,
          graph_json: opts.graph,
          thumbnail_url: opts.thumbnailUrl ?? null,
          version: 1,
          size_bytes: sizeBytes,
          node_count: nodeCount,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select()
        .single()

      if (inserted.error || !inserted.data) {
        throw new Error(`Supabase insert failed: ${inserted.error?.message ?? 'unknown error'}`)
      }
      await this.insertRevision(client, id, 1, opts.graph, opts.ownerId ?? null)
      return rowToMeta(inserted.data)
    }

    const currentVersion = existing.data.version
    if (typeof opts.expectedVersion === 'number' && opts.expectedVersion !== currentVersion) {
      throw new SceneVersionConflictError(
        `expected version ${opts.expectedVersion}, current ${currentVersion}`,
      )
    }

    const nextVersion = currentVersion + 1
    // Optimistic lock via `where version = currentVersion`.
    const updated = await client
      .from<SceneRow>(this.tableScenes)
      .update({
        name: opts.name,
        project_id: opts.projectId ?? existing.data.project_id,
        owner_id: opts.ownerId ?? existing.data.owner_id,
        graph_json: opts.graph,
        thumbnail_url:
          opts.thumbnailUrl === undefined ? existing.data.thumbnail_url : opts.thumbnailUrl,
        version: nextVersion,
        size_bytes: sizeBytes,
        node_count: nodeCount,
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('version', currentVersion)
      .select()
      .single()

    if (updated.error || !updated.data) {
      // Either someone raced us (version drifted) or the row vanished.
      throw new SceneVersionConflictError(
        updated.error?.message ?? 'version conflict during update',
      )
    }

    await this.insertRevision(client, id, nextVersion, opts.graph, opts.ownerId ?? null)
    return rowToMeta(updated.data)
  }

  async load(id: SceneId): Promise<SceneWithGraph | null> {
    const client = await this.client()
    const result = await client
      .from<SceneRow>(this.tableScenes)
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (result.error) {
      throw new Error(`Supabase load failed: ${result.error.message}`)
    }
    if (!result.data) return null

    return { ...rowToMeta(result.data), graph: result.data.graph_json }
  }

  async list(opts?: SceneListOptions): Promise<SceneMeta[]> {
    const client = await this.client()
    let query = client
      .from<SceneRow>(this.tableScenes)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(opts?.limit ?? DEFAULT_LIST_LIMIT)

    if (opts?.projectId) query = query.eq('project_id', opts.projectId)
    if (opts?.ownerId) query = query.eq('owner_id', opts.ownerId)

    const result = (await query) as SupabaseQueryResult<SceneRow[]>
    if (result.error) {
      throw new Error(`Supabase list failed: ${result.error.message}`)
    }
    return (result.data ?? []).map(rowToMeta)
  }

  async delete(id: SceneId, opts?: SceneMutateOptions): Promise<boolean> {
    const client = await this.client()

    if (typeof opts?.expectedVersion === 'number') {
      const existing = await client
        .from<SceneRow>(this.tableScenes)
        .select('version')
        .eq('id', id)
        .maybeSingle()

      if (existing.error) {
        throw new Error(`Supabase lookup failed: ${existing.error.message}`)
      }
      if (!existing.data) return false
      if (existing.data.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `expected version ${opts.expectedVersion}, current ${existing.data.version}`,
        )
      }
    }

    const deleted = await client
      .from<SceneRow>(this.tableScenes)
      .delete()
      .eq('id', id)
      .select()
      .maybeSingle()

    if (deleted.error) {
      throw new Error(`Supabase delete failed: ${deleted.error.message}`)
    }
    return deleted.data !== null
  }

  async rename(id: SceneId, newName: string, opts?: SceneMutateOptions): Promise<SceneMeta> {
    validateName(newName)
    const client = await this.client()

    const existing = await client
      .from<SceneRow>(this.tableScenes)
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (existing.error) {
      throw new Error(`Supabase lookup failed: ${existing.error.message}`)
    }
    if (!existing.data) {
      throw new SceneNotFoundError(`scene ${id} not found`)
    }

    if (
      typeof opts?.expectedVersion === 'number' &&
      opts.expectedVersion !== existing.data.version
    ) {
      throw new SceneVersionConflictError(
        `expected version ${opts.expectedVersion}, current ${existing.data.version}`,
      )
    }

    const nextVersion = existing.data.version + 1
    const updated = await client
      .from<SceneRow>(this.tableScenes)
      .update({
        name: newName,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('version', existing.data.version)
      .select()
      .single()

    if (updated.error || !updated.data) {
      throw new SceneVersionConflictError(
        updated.error?.message ?? 'version conflict during rename',
      )
    }
    return rowToMeta(updated.data)
  }

  private async insertRevision(
    client: SupabaseLikeClient,
    sceneId: string,
    version: number,
    graph: SceneGraph,
    authorId: string | null,
  ): Promise<void> {
    const result = await client.from<RevisionRow>(this.tableRevisions).insert({
      scene_id: sceneId,
      version,
      graph_json: graph,
      author_kind: 'mcp',
      author_id: authorId,
      created_at: new Date().toISOString(),
    })
    if (result.error) {
      // Revision history is best-effort; surface the failure so callers can
      // log / alert, but don't swallow it silently.
      throw new Error(`Supabase revision insert failed: ${result.error.message}`)
    }
  }
}
