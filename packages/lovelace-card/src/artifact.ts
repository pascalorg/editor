import type { AnyNode, AnyNodeId, Collection, CollectionId } from '@pascal-app/core'
import type {
  HomeAssistantCollectionBinding,
  PascalLovelaceSceneArtifact as HomeAssistantPascalLovelaceSceneArtifact,
  HomeAssistantResourceBinding,
} from '@pascal-app/home-assistant'
import {
  createHomeAssistantBindingNode,
  normalizeHomeAssistantCollectionBinding,
  normalizePascalLovelaceArtifactAssetUrls,
} from '@pascal-app/home-assistant'
import type {
  BindingControlSummary,
  HomeAssistantLike,
  PascalLovelaceSceneArtifact,
  PascalViewerCardConfig,
  PascalViewerCardHomeAssistantConfig,
  ResourceStateSummary,
} from './types'

export type ArtifactParseResult =
  | { artifact: PascalLovelaceSceneArtifact; error: null }
  | { artifact: null; error: string }

export function parsePascalLovelaceArtifact(input: unknown): ArtifactParseResult {
  if (!(input && typeof input === 'object')) {
    return { artifact: null, error: 'Scene artifact must be a JSON object.' }
  }

  const artifact = input as PascalLovelaceSceneArtifact
  if (artifact.version !== 1) {
    return { artifact: null, error: 'Unsupported Pascal Lovelace artifact version.' }
  }

  if (!(artifact.scene && typeof artifact.scene === 'object')) {
    return { artifact: null, error: 'Scene artifact is missing scene data.' }
  }

  if (!(artifact.scene.nodes && typeof artifact.scene.nodes === 'object')) {
    return { artifact: null, error: 'Scene artifact is missing scene.nodes.' }
  }

  if (!Array.isArray(artifact.scene.rootNodeIds)) {
    return { artifact: null, error: 'Scene artifact is missing scene.rootNodeIds.' }
  }

  return {
    artifact: normalizePascalLovelaceArtifactAssetUrls(
      artifact as HomeAssistantPascalLovelaceSceneArtifact,
    ) as PascalLovelaceSceneArtifact,
    error: null,
  }
}

export async function loadPascalLovelaceArtifact(
  configScene: unknown,
  sceneUrl: string | undefined,
): Promise<PascalLovelaceSceneArtifact> {
  if (configScene) {
    const parsed = parsePascalLovelaceArtifact(configScene)
    if (parsed.error || !parsed.artifact) {
      throw new Error(parsed.error ?? 'Failed to parse inline Pascal scene artifact.')
    }
    return parsed.artifact
  }

  if (!sceneUrl) {
    throw new Error('Missing scene_url for Pascal Lovelace card.')
  }

  const response = await fetch(sceneUrl, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`Failed to load Pascal scene artifact: ${response.status}`)
  }

  const parsed = parsePascalLovelaceArtifact(await response.json())
  if (parsed.error || !parsed.artifact) {
    throw new Error(parsed.error ?? 'Failed to parse Pascal scene artifact.')
  }
  return parsed.artifact
}

export function getArtifactBindings(
  artifact: PascalLovelaceSceneArtifact,
): HomeAssistantCollectionBinding[] {
  if (artifact.homeAssistant?.bindings?.length) {
    return artifact.homeAssistant.bindings
  }

  return Object.values(artifact.scene.nodes).flatMap((node) =>
    node?.type === 'home-assistant-binding' &&
    Array.isArray((node as { resources?: unknown }).resources)
      ? [node as unknown as HomeAssistantCollectionBinding]
      : [],
  )
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getConfigHomeAssistant(
  config: PascalViewerCardConfig,
): PascalViewerCardHomeAssistantConfig | null {
  return config.home_assistant ?? config.homeAssistant ?? null
}

function getNormalizedConfigBindings(
  homeAssistantConfig: PascalViewerCardHomeAssistantConfig | null,
) {
  if (!Array.isArray(homeAssistantConfig?.bindings)) {
    return null
  }

  return homeAssistantConfig.bindings
    .map((binding) => normalizeHomeAssistantCollectionBinding(binding))
    .filter((binding): binding is HomeAssistantCollectionBinding => Boolean(binding))
}

function removeHomeAssistantBindingNodes(scene: PascalLovelaceSceneArtifact['scene']) {
  const removedNodeIds = new Set<AnyNodeId>()

  for (const [nodeId, node] of Object.entries(scene.nodes) as Array<[AnyNodeId, AnyNode]>) {
    if ((node as { type?: unknown })?.type === 'home-assistant-binding') {
      delete scene.nodes[nodeId]
      removedNodeIds.add(nodeId)
    }
  }

  if (removedNodeIds.size > 0) {
    scene.rootNodeIds = scene.rootNodeIds.filter((nodeId) => !removedNodeIds.has(nodeId))
  }
}

function findBindingNodeId(
  nodes: Record<string, unknown>,
  collectionId: CollectionId,
): AnyNodeId | undefined {
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (
      node &&
      typeof node === 'object' &&
      (node as { type?: unknown }).type === 'home-assistant-binding' &&
      (node as { collectionId?: unknown }).collectionId === collectionId
    ) {
      return nodeId as AnyNodeId
    }
  }

  return undefined
}

export function applyPascalViewerCardHomeAssistantConfig(
  artifact: PascalLovelaceSceneArtifact,
  config: PascalViewerCardConfig,
): PascalLovelaceSceneArtifact {
  const nextArtifact = cloneJson(artifact)
  const homeAssistantConfig = getConfigHomeAssistant(config)
  const configBindings = getNormalizedConfigBindings(homeAssistantConfig)
  const hasConfigOverride = configBindings !== null
  const bindings = configBindings ?? getArtifactBindings(nextArtifact)

  nextArtifact.scene.collections = {
    ...(nextArtifact.scene.collections ?? {}),
    ...(homeAssistantConfig?.collections ?? {}),
  }

  if (hasConfigOverride) {
    removeHomeAssistantBindingNodes(nextArtifact.scene)
  }

  if (bindings.length > 0 || hasConfigOverride) {
    nextArtifact.homeAssistant = {
      ...(nextArtifact.homeAssistant ?? {}),
      bindings: cloneJson(bindings),
    }
  }

  for (const binding of bindings) {
    const collection = nextArtifact.scene.collections?.[binding.collectionId]
    const existingNodeId = findBindingNodeId(nextArtifact.scene.nodes, binding.collectionId)
    const bindingNode = createHomeAssistantBindingNode({
      binding,
      ...(existingNodeId ? { id: existingNodeId as never } : {}),
      name: collection?.name,
    })

    if (!bindingNode) {
      continue
    }

    nextArtifact.scene.nodes[bindingNode.id as AnyNodeId] = bindingNode as unknown as AnyNode
    if (!nextArtifact.scene.rootNodeIds.includes(bindingNode.id as AnyNodeId)) {
      nextArtifact.scene.rootNodeIds.push(bindingNode.id as AnyNodeId)
    }
  }

  return nextArtifact
}

export function getResourceEntityIds(resource: HomeAssistantResourceBinding): string[] {
  const ids = [
    resource.entityId,
    ...(Array.isArray(resource.memberEntityIds) ? resource.memberEntityIds : []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return Array.from(new Set(ids))
}

function summarizeEntityState(hass: HomeAssistantLike | null, entityId: string) {
  const stateObj = hass?.states?.[entityId]
  const state = stateObj?.state ?? 'missing'
  const domain = entityId.split('.', 1)[0] ?? ''
  const unavailable = state === 'missing' || state === 'unavailable' || state === 'unknown'
  const inactiveStates =
    domain === 'media_player' ? ['off', 'standby'] : ['closed', 'idle', 'locked', 'off', 'standby']
  const brightness = stateObj?.attributes?.brightness
  const percentage = stateObj?.attributes?.percentage
  const volume = stateObj?.attributes?.volume_level
  const brightnessPct =
    typeof brightness === 'number'
      ? Math.round((brightness / 255) * 100)
      : typeof percentage === 'number'
        ? Math.round(percentage)
        : typeof volume === 'number'
          ? Math.round(volume * 100)
          : null

  return {
    available: !unavailable,
    brightnessPct,
    isOn: !unavailable && !inactiveStates.includes(state),
    state,
  }
}

export function summarizeResourceState(
  hass: HomeAssistantLike | null,
  resource: HomeAssistantResourceBinding,
): ResourceStateSummary {
  const entityIds = getResourceEntityIds(resource)
  const entityStates = entityIds.map((entityId) => summarizeEntityState(hass, entityId))
  const available = entityStates.some((state) => state.available)
  const isOn = entityStates.some((state) => state.isOn)
  const brightnessPct =
    entityStates.find((state) => typeof state.brightnessPct === 'number')?.brightnessPct ?? null
  const primaryEntityId = entityIds[0] ?? null
  const primaryState = primaryEntityId ? summarizeEntityState(hass, primaryEntityId) : null

  return {
    available,
    brightnessPct,
    entityIds,
    isOn,
    label: resource.label || resource.entityId || resource.id,
    primaryEntityId,
    stateLabel: primaryState?.state ?? (primaryEntityId ? 'missing' : 'unbound'),
  }
}

export function summarizeBindingControl(
  hass: HomeAssistantLike | null,
  collections: Record<string, Collection>,
  binding: HomeAssistantCollectionBinding,
): BindingControlSummary {
  const resources = binding.resources ?? []
  const primaryResource =
    resources.find((resource) => resource.id === binding.primaryResourceId) ?? resources[0] ?? null
  const resourceStates = resources.map((resource) => summarizeResourceState(hass, resource))
  const primaryState = primaryResource
    ? summarizeResourceState(hass, primaryResource)
    : {
        available: false,
        brightnessPct: null,
        entityIds: [],
        isOn: false,
        label: 'Unbound',
        primaryEntityId: null,
        stateLabel: 'unbound',
      }

  const collection = collections[binding.collectionId]
  return {
    binding,
    collectionName: binding.presentation?.label || collection?.name || 'Pascal control',
    primaryResource,
    resourceStates,
    state: primaryState,
  }
}
