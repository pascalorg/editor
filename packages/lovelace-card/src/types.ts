import type { AnyNodeId, Collection, CollectionId } from '@pascal-app/core'
import type {
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '@pascal-app/home-assistant'

export type PascalLovelaceSceneArtifact = {
  version: 1
  scene: {
    nodes: Record<string, any>
    rootNodeIds: AnyNodeId[]
    collections?: Record<CollectionId, Collection>
  }
  homeAssistant?: {
    bindings?: HomeAssistantCollectionBinding[]
  }
  viewer?: {
    defaultLevelId?: string | null
    defaultMode?: PascalLovelaceCardMode
    defaultRoomId?: string | null
    levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
    viewMode?: '3d' | '2d'
    wallMode?: 'up' | 'cutaway' | 'down'
  }
  assets?: {
    baseUrl?: string
    files?: Record<string, string>
  }
}

export type PascalLovelaceCardMode = 'compact' | 'overview' | 'room'

export type HassActionConfig = {
  action?: 'assist' | 'more-info' | 'navigate' | 'none' | 'perform-action' | 'toggle' | 'url'
  confirmation?: boolean | { text?: string }
  entity?: string
  navigation_path?: string
  perform_action?: string
  service?: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
  url_path?: string
}

export type PascalViewerCardConfig = {
  type?: string
  scene?: PascalLovelaceSceneArtifact
  scene_url?: string
  mode?: PascalLovelaceCardMode
  room?: string
  default_level?: string
  view_mode?: '2d' | '3d'
  renderer?: 'auto' | 'webgpu'
  show_floor_selector?: boolean
  show_header?: boolean
  tap_action?: HassActionConfig
  hold_action?: HassActionConfig
  double_tap_action?: HassActionConfig
}

export type HassEntity = {
  attributes?: Record<string, unknown>
  entity_id: string
  last_changed?: string
  last_updated?: string
  state: string
}

export type HomeAssistantLike = {
  callService: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ) => Promise<unknown>
  states: Record<string, HassEntity | undefined>
  user?: { name?: string }
}

export type ResourceStateSummary = {
  available: boolean
  brightnessPct: number | null
  entityIds: string[]
  isOn: boolean
  label: string
  primaryEntityId: string | null
  stateLabel: string
}

export type BindingControlSummary = {
  binding: HomeAssistantCollectionBinding
  collectionName: string
  primaryResource: HomeAssistantResourceBinding | null
  resourceStates: ResourceStateSummary[]
  state: ResourceStateSummary
}

export type PendingHomeAssistantState = {
  brightnessPct?: number
  desiredOn?: boolean
  expiresAt: number
}
