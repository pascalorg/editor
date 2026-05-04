import type {
  AnyNode,
  AnyNodeId,
  Collection,
  CollectionId,
  HomeAssistantCollectionBinding,
} from '@pascal-app/core'

export type PascalLovelaceSceneArtifact = {
  version: 1
  scene: {
    nodes: Record<AnyNodeId, AnyNode>
    rootNodeIds: AnyNodeId[]
    collections?: Record<CollectionId, Collection>
  }
  homeAssistant?: {
    bindings?: HomeAssistantCollectionBinding[]
  }
  viewer?: {
    defaultLevelId?: string | null
    defaultMode?: 'compact' | 'overview' | 'room'
    levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
    viewMode?: '2d' | '3d'
    wallMode?: 'up' | 'cutaway' | 'down'
  }
}

export type PascalLovelaceCardConfig = {
  type: 'custom:pascal-viewer-card'
  mode: 'compact' | 'overview' | 'room'
  show_header: boolean
  tap_action: { action: 'toggle' }
  scene: PascalLovelaceSceneArtifact
}

export type CreatePascalLovelaceArtifactInput = {
  bindings: HomeAssistantCollectionBinding[]
  collections: Record<CollectionId, Collection>
  defaultLevelId?: string | null
  levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  wallMode?: 'up' | 'cutaway' | 'down'
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function removeAuthoringReferenceNodes(scene: PascalLovelaceSceneArtifact['scene']) {
  const removedNodeIds = new Set<AnyNodeId>()

  for (const [nodeId, node] of Object.entries(scene.nodes) as Array<[AnyNodeId, AnyNode]>) {
    if (node?.type === 'guide' || node?.type === 'scan') {
      delete scene.nodes[nodeId]
      removedNodeIds.add(nodeId)
    }
  }

  if (removedNodeIds.size === 0) {
    return
  }

  scene.rootNodeIds = scene.rootNodeIds.filter((nodeId) => !removedNodeIds.has(nodeId))

  for (const node of Object.values(scene.nodes)) {
    const parentNode = node as { children?: AnyNodeId[] }
    if (Array.isArray(parentNode.children)) {
      parentNode.children = parentNode.children.filter((childId) => !removedNodeIds.has(childId))
    }
  }

  for (const collection of Object.values(scene.collections ?? {})) {
    if (Array.isArray(collection?.nodeIds)) {
      collection.nodeIds = collection.nodeIds.filter((nodeId) => !removedNodeIds.has(nodeId))
    }
    const mutableCollection = collection as {
      controlNodeId?: AnyNodeId | null
      nodeIds?: AnyNodeId[]
    }
    if (
      mutableCollection.controlNodeId &&
      removedNodeIds.has(mutableCollection.controlNodeId)
    ) {
      mutableCollection.controlNodeId = mutableCollection.nodeIds?.[0] ?? null
    }
  }
}

export function createPascalLovelaceArtifact({
  bindings,
  collections,
  defaultLevelId,
  levelMode,
  nodes,
  rootNodeIds,
  wallMode,
}: CreatePascalLovelaceArtifactInput): PascalLovelaceSceneArtifact {
  const artifact: PascalLovelaceSceneArtifact = {
    homeAssistant: {
      bindings: cloneJson(bindings),
    },
    scene: {
      collections: cloneJson(collections),
      nodes: cloneJson(nodes),
      rootNodeIds: cloneJson(rootNodeIds),
    },
    version: 1,
    viewer: {
      defaultLevelId: defaultLevelId ?? null,
      defaultMode: 'overview',
      levelMode: levelMode ?? 'solo',
      viewMode: '3d',
      wallMode: wallMode ?? 'cutaway',
    },
  }

  removeAuthoringReferenceNodes(artifact.scene)
  return artifact
}

export function createPascalLovelaceCardConfig(
  artifact: PascalLovelaceSceneArtifact,
): PascalLovelaceCardConfig {
  return {
    mode: artifact.viewer?.defaultMode ?? 'overview',
    scene: artifact,
    show_header: true,
    tap_action: { action: 'toggle' },
    type: 'custom:pascal-viewer-card',
  }
}

export function createPascalLovelaceCardConfigText(config: PascalLovelaceCardConfig) {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function downloadPascalLovelaceCardConfig(text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'pascal-viewer-card-config.json'
  anchor.click()
  URL.revokeObjectURL(url)
}
