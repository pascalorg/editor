import { SceneBridge } from '../../bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from '../../operations'
import {
  type ProjectCreateOptions,
  type ProjectStatus,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneSaveOptions,
  type SceneStore,
  SceneVersionConflictError,
  type SceneWithGraph,
} from '../../storage/types'
import { computeGraphHash, editorUrlFor } from './metadata'

export type StoredTextContent = { type: string; text: string }

export function parseToolText(content: StoredTextContent[]): Record<string, unknown> {
  return JSON.parse(content[0]!.text) as Record<string, unknown>
}

export function createTestSceneOperations(options?: {
  bridge?: SceneBridge
  store?: InMemorySceneStore
}): {
  bridge: SceneBridge
  store: InMemorySceneStore
  operations: SceneOperations
} {
  const bridge = options?.bridge ?? new SceneBridge()
  const store = options?.store ?? new InMemorySceneStore()
  const operations = createSceneOperations({ bridge, store })
  return { bridge, store, operations }
}

/**
 * In-memory `SceneStore` for tests. Backed by a plain `Map` keyed by id.
 * Implements the full interface including optimistic concurrency via
 * `expectedVersion`.
 */
export class InMemorySceneStore implements SceneStore {
  readonly backend = 'sqlite' as const
  private readonly data = new Map<string, SceneWithGraph>()
  private readonly projects = new Map<
    string,
    {
      id: string
      name: string
      ownerId: string | null
      isPrivate: boolean
      thumbnailUrl: string | null
      createdAt: string
      updatedAt: string
    }
  >()
  private idCounter = 0
  private projectCounter = 0

  async createProject(opts: ProjectCreateOptions): Promise<ProjectStatus> {
    const id = opts.id ?? `project_${++this.projectCounter}`
    const now = new Date().toISOString()
    this.projects.set(id, {
      id,
      name: opts.name,
      ownerId: opts.ownerId ?? null,
      isPrivate: opts.isPrivate ?? true,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    return this.toProjectStatus(id)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    if (!(this.projects.has(id) || this.data.has(id))) return null
    return this.toProjectStatus(id)
  }

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
        editorUrl: existing.editorUrl ?? `/editor/${existing.id}`,
        url: existing.url ?? `/editor/${existing.id}`,
        published: true,
        graphHash: computeGraphHash(opts.graph),
        graph: opts.graph,
      }
      this.data.set(existing.id, updated)
      this.touchProject(existing.id, opts.name, updated.updatedAt)
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
      projectId: opts.projectId ?? (this.projects.has(id) ? id : null),
      thumbnailUrl: opts.thumbnailUrl ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ownerId: opts.ownerId ?? null,
      sizeBytes: serialized.length,
      nodeCount,
      editorUrl: `/editor/${id}`,
      url: `/editor/${id}`,
      published: true,
      graphHash: computeGraphHash(opts.graph),
      graph: opts.graph,
    }
    this.data.set(id, record)
    this.touchProject(id, opts.name, now)
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
    this.touchProject(id, newName, updated.updatedAt)
    return this.toMeta(updated)
  }

  private touchProject(id: string, name: string, updatedAt: string): void {
    const existing = this.projects.get(id)
    if (existing) {
      this.projects.set(id, { ...existing, name, updatedAt })
      return
    }
    this.projects.set(id, {
      id,
      name,
      ownerId: null,
      isPrivate: true,
      thumbnailUrl: null,
      createdAt: updatedAt,
      updatedAt,
    })
  }

  private toMeta(rec: SceneWithGraph): SceneMeta {
    const editorUrl = editorUrlFor(rec)
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
      editorUrl,
      url: editorUrl,
      published: rec.published ?? true,
      graphHash: rec.graphHash ?? computeGraphHash(rec.graph),
    }
  }

  private toProjectStatus(id: string): ProjectStatus {
    const project = this.projects.get(id)
    const scene = this.data.get(id)
    const now = new Date().toISOString()
    const editorUrl = `/editor/${id}`
    return {
      id,
      projectId: id,
      name: scene?.name ?? project?.name ?? id,
      editorUrl,
      url: editorUrl,
      ownerId: scene?.ownerId ?? project?.ownerId ?? null,
      thumbnailUrl: scene?.thumbnailUrl ?? project?.thumbnailUrl ?? null,
      publishedVersion: scene?.version ?? null,
      latestVersion: scene?.version ?? null,
      draftVersion: null,
      browserVisibleVersion: scene?.version ?? null,
      version: scene?.version ?? 0,
      isEmpty: !scene || scene.nodeCount === 0,
      sizeBytes: scene?.sizeBytes ?? 0,
      nodeCount: scene?.nodeCount ?? 0,
      graphHash: scene?.graphHash ?? (scene ? computeGraphHash(scene.graph) : null),
      createdAt: scene?.createdAt ?? project?.createdAt ?? now,
      updatedAt: scene?.updatedAt ?? project?.updatedAt ?? now,
    }
  }
}
