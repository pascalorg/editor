import { createHash } from 'node:crypto'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNodeId } from '@pascal-app/core/schema'
import type { SceneOperations } from '../../operations'
import type { ProjectStatus, SceneMeta } from '../../storage/types'

export function computeGraphHash(graph: SceneGraph): string {
  const normalized = JSON.stringify({
    nodes: graph.nodes ?? {},
    rootNodeIds: graph.rootNodeIds ?? [],
    collections: (graph as Record<string, unknown>).collections ?? {},
  })
  return createHash('sha256').update(normalized).digest('hex')
}

export function editorUrlFor(meta: Pick<SceneMeta, 'id' | 'editorUrl' | 'url'>): string {
  return meta.editorUrl ?? meta.url ?? `/editor/${meta.id}`
}

export function sceneMetaPayload(meta: SceneMeta, graph?: SceneGraph) {
  const editorUrl = editorUrlFor(meta)
  return {
    id: meta.id,
    name: meta.name,
    projectId: meta.projectId,
    thumbnailUrl: meta.thumbnailUrl,
    version: meta.version,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    ownerId: meta.ownerId,
    sizeBytes: meta.sizeBytes,
    nodeCount: meta.nodeCount,
    editorUrl,
    url: editorUrl,
    published: meta.published ?? true,
    isDraft: meta.isDraft ?? false,
    saveMode: meta.saveMode ?? (meta.isDraft ? 'draft' : 'checkpoint'),
    graphHash: meta.graphHash ?? (graph ? computeGraphHash(graph) : undefined),
  }
}

export function projectStatusPayload(status: ProjectStatus, nextStep?: string) {
  return {
    id: status.id,
    projectId: status.projectId,
    name: status.name,
    editorUrl: status.editorUrl,
    url: status.url,
    ownerId: status.ownerId,
    thumbnailUrl: status.thumbnailUrl,
    publishedVersion: status.publishedVersion,
    latestVersion: status.latestVersion,
    draftVersion: status.draftVersion,
    browserVisibleVersion: status.browserVisibleVersion,
    version: status.version,
    isEmpty: status.isEmpty,
    sizeBytes: status.sizeBytes,
    nodeCount: status.nodeCount,
    graphHash: status.graphHash,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
    ...(nextStep ? { nextStep } : {}),
  }
}

export function currentLevelContext(operations: SceneOperations) {
  const levels = operations.findNodes({ type: 'level' }).sort((a, b) => {
    const aa = a.type === 'level' ? a.level : 0
    const bb = b.type === 'level' ? b.level : 0
    return aa - bb
  })
  const levelIds = levels.map((level) => level.id as AnyNodeId as string)
  return {
    levelIds,
    defaultLevelId: levelIds[0] ?? null,
  }
}
