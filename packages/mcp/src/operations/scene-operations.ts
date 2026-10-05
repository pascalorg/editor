import type { NodeDeletionPlan, NodeDeletionScene } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId, AnyNodeType } from '@pascal-app/core/schema'
import type { ActiveSceneMeta, Patch, SceneBridge, ValidationResult } from '../bridge/scene-bridge'
import type {
  ProjectCreateOptions,
  ProjectStatus,
  SceneEvent,
  SceneEventAppendOptions,
  SceneEventListOptions,
  SceneListOptions,
  SceneMeta,
  SceneMutateOptions,
  SceneSaveOptions,
  SceneStore,
  SceneWithGraph,
} from '../storage/types'

export type CreateSceneOperationsOptions = {
  bridge?: SceneBridge
  store?: SceneStore
}

export interface SceneOperations {
  readonly hasBridge: boolean
  readonly hasStore: boolean
  readonly hasSceneEvents: boolean
  readonly canAppendSceneEvents: boolean
  readonly canListSceneEvents: boolean
  readonly canCreateProject: boolean
  readonly canGetProjectStatus: boolean
  readonly storeBackend: SceneStore['backend'] | null

  setActiveScene(meta: ActiveSceneMeta): void
  getActiveScene(): ActiveSceneMeta | null
  clearActiveScene(): void
  loadDefault(): void
  setScene(nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: AnyNodeId[]): void
  exportJSON(): SceneGraph & { collections: Record<string, unknown> }
  exportSceneGraph(): SceneGraph
  loadJSON(json: string | SceneGraph): void
  getNode(id: AnyNodeId): AnyNode | null
  getNodes(): Record<AnyNodeId, AnyNode>
  getRootNodeIds(): AnyNodeId[]
  getChildren(parentId: AnyNodeId): AnyNode[]
  getAncestry(id: AnyNodeId): AnyNode[]
  findNodes(filter: {
    type?: AnyNodeType
    parentId?: AnyNodeId | null
    levelId?: AnyNodeId
  }): AnyNode[]
  resolveLevelId(id: AnyNodeId): AnyNodeId | null
  createNode(node: AnyNode, parentId?: AnyNodeId): AnyNodeId
  updateNode(id: AnyNodeId, data: Partial<AnyNode>): void
  deleteNode(id: AnyNodeId, cascade?: boolean): string[]
  applyPatch(patches: Patch[]): {
    appliedOps: number
    deletedIds: AnyNodeId[]
    createdIds: AnyNodeId[]
  }
  /**
   * The active bridge's deletion preview, when it has one. Absent for bridges
   * that cannot preview their own deletes; the apply_patch guard is then stricter.
   */
  readonly planDeletion?: (scene: NodeDeletionScene, ids: AnyNodeId[]) => NodeDeletionPlan
  deriveStructure(levelIds?: AnyNodeId[]): { createdIds: AnyNodeId[]; deletedIds: AnyNodeId[] }
  undo(steps?: number): number
  redo(steps?: number): number
  validateScene(): ValidationResult
  flushDirty(): string[]
  getHistory(): { pastCount: number; futureCount: number }
  clearHistory(): void
  runAsSingleHistoryStep<T>(run: () => T): T

  createProject(options: ProjectCreateOptions): Promise<ProjectStatus>
  getProjectStatus(id: string): Promise<ProjectStatus | null>
  saveScene(options: SceneSaveOptions): Promise<SceneMeta>
  loadStoredScene(id: string): Promise<SceneWithGraph | null>
  listScenes(options?: SceneListOptions): Promise<SceneMeta[]>
  deleteStoredScene(id: string, options?: SceneMutateOptions): Promise<boolean>
  renameStoredScene(id: string, newName: string, options?: SceneMutateOptions): Promise<SceneMeta>
  appendSceneEvent(options: SceneEventAppendOptions): Promise<SceneEvent | null>
  listSceneEvents(id: string, options?: SceneEventListOptions): Promise<SceneEvent[]>
}

export function createSceneOperations(options: CreateSceneOperationsOptions): SceneOperations {
  return new SceneOperationsFacade(options)
}

class SceneOperationsFacade implements SceneOperations {
  readonly #bridge?: SceneBridge
  readonly #store?: SceneStore

  readonly planDeletion?: (scene: NodeDeletionScene, ids: AnyNodeId[]) => NodeDeletionPlan

  constructor(options: CreateSceneOperationsOptions) {
    this.#bridge = options.bridge
    this.#store = options.store
    const bridge = options.bridge as
      | { planDeletion?: (scene: NodeDeletionScene, ids: AnyNodeId[]) => NodeDeletionPlan }
      | undefined
    if (typeof bridge?.planDeletion === 'function') {
      this.planDeletion = (scene, ids) => bridge.planDeletion!(scene, ids)
    }
  }

  get hasBridge(): boolean {
    return this.#bridge !== undefined
  }

  get hasStore(): boolean {
    return this.#store !== undefined
  }

  get hasSceneEvents(): boolean {
    return this.canAppendSceneEvents && this.canListSceneEvents
  }

  get canAppendSceneEvents(): boolean {
    return typeof this.#store?.appendSceneEvent === 'function'
  }

  get canListSceneEvents(): boolean {
    return typeof this.#store?.listSceneEvents === 'function'
  }

  get canCreateProject(): boolean {
    return typeof this.#store?.createProject === 'function'
  }

  get canGetProjectStatus(): boolean {
    return typeof this.#store?.getProjectStatus === 'function'
  }

  get storeBackend(): SceneStore['backend'] | null {
    return this.#store?.backend ?? null
  }

  setActiveScene(meta: ActiveSceneMeta): void {
    this.requireBridge().setActiveScene(meta)
  }

  getActiveScene(): ActiveSceneMeta | null {
    return this.requireBridge().getActiveScene()
  }

  clearActiveScene(): void {
    this.requireBridge().clearActiveScene()
  }

  loadDefault(): void {
    this.requireBridge().loadDefault()
  }

  setScene(nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: AnyNodeId[]): void {
    this.requireBridge().setScene(nodes, rootNodeIds)
  }

  exportJSON(): SceneGraph & { collections: Record<string, unknown> } {
    return this.requireBridge().exportJSON()
  }

  exportSceneGraph(): SceneGraph {
    const exported = this.exportJSON()
    return {
      nodes: exported.nodes,
      rootNodeIds: exported.rootNodeIds,
      collections: exported.collections as SceneGraph['collections'],
      materials: exported.materials,
      installedPlugins: exported.installedPlugins,
    }
  }

  loadJSON(json: string | SceneGraph): void {
    this.requireBridge().loadJSON(json)
  }

  getNode(id: AnyNodeId): AnyNode | null {
    return this.requireBridge().getNode(id)
  }

  getNodes(): Record<AnyNodeId, AnyNode> {
    return this.requireBridge().getNodes()
  }

  getRootNodeIds(): AnyNodeId[] {
    return this.requireBridge().getRootNodeIds()
  }

  getChildren(parentId: AnyNodeId): AnyNode[] {
    return this.requireBridge().getChildren(parentId)
  }

  getAncestry(id: AnyNodeId): AnyNode[] {
    return this.requireBridge().getAncestry(id)
  }

  findNodes(filter: {
    type?: AnyNodeType
    parentId?: AnyNodeId | null
    levelId?: AnyNodeId
  }): AnyNode[] {
    return this.requireBridge().findNodes(filter)
  }

  resolveLevelId(id: AnyNodeId): AnyNodeId | null {
    return this.requireBridge().resolveLevelId(id)
  }

  createNode(node: AnyNode, parentId?: AnyNodeId): AnyNodeId {
    return this.requireBridge().createNode(node, parentId)
  }

  updateNode(id: AnyNodeId, data: Partial<AnyNode>): void {
    this.requireBridge().updateNode(id, data)
  }

  deleteNode(id: AnyNodeId, cascade?: boolean): string[] {
    return this.requireBridge().deleteNode(id, cascade)
  }

  applyPatch(patches: Patch[]): {
    appliedOps: number
    deletedIds: AnyNodeId[]
    createdIds: AnyNodeId[]
  } {
    return this.requireBridge().applyPatch(patches)
  }

  /**
   * Derive construction from the intent the tools just wrote. The hosted
   * bridge reconciles inside every mutation and exposes no hook, so the call
   * is optional: there it is already done by the time a tool builds its result.
   */
  deriveStructure(levelIds?: AnyNodeId[]): { createdIds: AnyNodeId[]; deletedIds: AnyNodeId[] } {
    return this.requireBridge().deriveStructure?.(levelIds) ?? { createdIds: [], deletedIds: [] }
  }

  undo(steps?: number): number {
    return this.requireBridge().undo(steps)
  }

  redo(steps?: number): number {
    return this.requireBridge().redo(steps)
  }

  validateScene(): ValidationResult {
    return this.requireBridge().validateScene()
  }

  flushDirty(): string[] {
    return this.requireBridge().flushDirty()
  }

  getHistory(): { pastCount: number; futureCount: number } {
    return this.requireBridge().getHistory()
  }

  clearHistory(): void {
    this.requireBridge().clearHistory()
  }

  runAsSingleHistoryStep<T>(run: () => T): T {
    return this.requireBridge().runAsSingleHistoryStep(run)
  }

  async createProject(options: ProjectCreateOptions): Promise<ProjectStatus> {
    const store = this.requireStore()
    if (!store.createProject) {
      throw new Error('create_project_unavailable')
    }
    return store.createProject(options)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    const store = this.requireStore()
    if (store.getProjectStatus) {
      return store.getProjectStatus(id)
    }
    const scene = await store.load(id)
    if (!scene) return null
    const editorUrl = scene.editorUrl ?? `/editor/${scene.id}`
    return {
      id: scene.id,
      projectId: scene.projectId ?? scene.id,
      name: scene.name,
      editorUrl,
      url: editorUrl,
      ownerId: scene.ownerId,
      thumbnailUrl: scene.thumbnailUrl,
      publishedVersion: scene.published === false ? null : scene.version,
      latestVersion: scene.version,
      draftVersion: null,
      browserVisibleVersion: scene.version,
      version: scene.version,
      isEmpty: scene.nodeCount === 0,
      sizeBytes: scene.sizeBytes,
      nodeCount: scene.nodeCount,
      graphHash: scene.graphHash ?? null,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
    }
  }

  async saveScene(options: SceneSaveOptions): Promise<SceneMeta> {
    return this.requireStore().save(options)
  }

  async loadStoredScene(id: string): Promise<SceneWithGraph | null> {
    return this.requireStore().load(id)
  }

  async listScenes(options?: SceneListOptions): Promise<SceneMeta[]> {
    return this.requireStore().list(options)
  }

  async deleteStoredScene(id: string, options?: SceneMutateOptions): Promise<boolean> {
    return this.requireStore().delete(id, options)
  }

  async renameStoredScene(
    id: string,
    newName: string,
    options?: SceneMutateOptions,
  ): Promise<SceneMeta> {
    return this.requireStore().rename(id, newName, options)
  }

  async appendSceneEvent(options: SceneEventAppendOptions): Promise<SceneEvent | null> {
    const store = this.requireStore()
    if (!store.appendSceneEvent) return null
    return store.appendSceneEvent(options)
  }

  async listSceneEvents(id: string, options?: SceneEventListOptions): Promise<SceneEvent[]> {
    const store = this.requireStore()
    if (!store.listSceneEvents) {
      throw new Error('scene_events_unavailable')
    }
    return store.listSceneEvents(id, options)
  }

  private requireBridge(): SceneBridge {
    if (!this.#bridge) {
      throw new Error('scene_bridge_unavailable')
    }
    return this.#bridge
  }

  private requireStore(): SceneStore {
    if (!this.#store) {
      throw new Error('scene_store_unavailable')
    }
    return this.#store
  }
}
