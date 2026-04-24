import {
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneSaveOptions,
  type SceneStore,
  SceneVersionConflictError,
  type SceneWithGraph,
} from '../../storage/types'

export type StoredTextContent = { type: string; text: string }

export function parseToolText(content: StoredTextContent[]): Record<string, unknown> {
  return JSON.parse(content[0]!.text) as Record<string, unknown>
}

/**
 * In-memory `SceneStore` for tests. Backed by a plain `Map` keyed by id.
 * Implements the full interface including optimistic concurrency via
 * `expectedVersion`.
 */
export class InMemorySceneStore implements SceneStore {
  readonly backend = 'sqlite' as const
  private readonly data = new Map<string, SceneWithGraph>()
  private idCounter = 0

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    const existing = opts.id ? this.data.get(opts.id) : undefined
    if (existing) {
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Expected version ${opts.expectedVersion}, have ${existing.version}`,
        )
      }
      const now = new Date().toISOString()
      const nodeCount = Object.keys(opts.graph.nodes ?? {}).length
      const serialized = JSON.stringify(opts.graph)
      const updated: SceneWithGraph = {
        id: existing.id,
        name: opts.name,
        projectId: opts.projectId ?? existing.projectId,
        thumbnailUrl: opts.thumbnailUrl ?? existing.thumbnailUrl,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: now,
        ownerId: opts.ownerId ?? existing.ownerId,
        sizeBytes: serialized.length,
        nodeCount,
        graph: opts.graph,
      }
      this.data.set(existing.id, updated)
      return this.toMeta(updated)
    }

    if (opts.expectedVersion !== undefined) {
      throw new SceneVersionConflictError('Cannot pass expectedVersion for a new scene')
    }

    const id = opts.id ?? `scene_${++this.idCounter}`
    const now = new Date().toISOString()
    const serialized = JSON.stringify(opts.graph)
    const nodeCount = Object.keys(opts.graph.nodes ?? {}).length
    const record: SceneWithGraph = {
      id,
      name: opts.name,
      projectId: opts.projectId ?? null,
      thumbnailUrl: opts.thumbnailUrl ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ownerId: opts.ownerId ?? null,
      sizeBytes: serialized.length,
      nodeCount,
      graph: opts.graph,
    }
    this.data.set(id, record)
    return this.toMeta(record)
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const rec = this.data.get(id)
    if (!rec) return null
    return {
      ...rec,
      graph: JSON.parse(JSON.stringify(rec.graph)),
    }
  }

  async list(opts?: SceneListOptions): Promise<SceneMeta[]> {
    let scenes = Array.from(this.data.values()).map((r) => this.toMeta(r))
    if (opts?.projectId !== undefined) {
      scenes = scenes.filter((s) => s.projectId === opts.projectId)
    }
    if (opts?.ownerId !== undefined) {
      scenes = scenes.filter((s) => s.ownerId === opts.ownerId)
    }
    scenes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (opts?.limit !== undefined) scenes = scenes.slice(0, opts.limit)
    return scenes
  }

  async delete(id: string, opts?: SceneMutateOptions): Promise<boolean> {
    const rec = this.data.get(id)
    if (!rec) throw new SceneNotFoundError(`Scene ${id} not found`)
    if (opts?.expectedVersion !== undefined && rec.version !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Expected version ${opts.expectedVersion}, have ${rec.version}`,
      )
    }
    return this.data.delete(id)
  }

  async rename(id: string, newName: string, opts?: SceneMutateOptions): Promise<SceneMeta> {
    const rec = this.data.get(id)
    if (!rec) throw new SceneNotFoundError(`Scene ${id} not found`)
    if (opts?.expectedVersion !== undefined && rec.version !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Expected version ${opts.expectedVersion}, have ${rec.version}`,
      )
    }
    const updated: SceneWithGraph = {
      ...rec,
      name: newName,
      version: rec.version + 1,
      updatedAt: new Date().toISOString(),
    }
    this.data.set(id, updated)
    return this.toMeta(updated)
  }

  private toMeta(rec: SceneWithGraph): SceneMeta {
    return {
      id: rec.id,
      name: rec.name,
      projectId: rec.projectId,
      thumbnailUrl: rec.thumbnailUrl,
      version: rec.version,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      ownerId: rec.ownerId,
      sizeBytes: rec.sizeBytes,
      nodeCount: rec.nodeCount,
    }
  }
}
