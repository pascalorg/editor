import type {
  BindingControlSummary,
  HomeAssistantLike,
  PascalLovelaceSceneArtifact,
  ResourceStateSummary,
} from './types'
import type {
  Collection,
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '@pascal-app/core'

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

  return { artifact, error: null }
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
  const unavailable = state === 'missing' || state === 'unavailable' || state === 'unknown'
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
    isOn: !unavailable && !['closed', 'idle', 'locked', 'off', 'standby'].includes(state),
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
