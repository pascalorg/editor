import type { AnyNode, AnyNodeId } from '../schema/types'
import type { SceneSnapshot } from '../store/history-control'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_AUTH = 2
export const MESSAGE_QUERY_AWARENESS = 3

export type ClientRole = 'editor' | 'viewer'

export interface UserCursor {
  worldPosition: [number, number, number] | null
  planPosition?: [number, number] | null
}

export interface UserSelection {
  selectedNodeIds: string[]
}

export interface UserActiveDrag {
  nodeId: string
  position: [number, number, number]
  rotation?: number
  supportElevationCap?: number
}

export interface UserPresence {
  userId: string
  name: string
  role: ClientRole
  color: string
  cursor?: UserCursor | null
  selection?: UserSelection | null
  activeDrag?: UserActiveDrag | null
  lastActive?: number
}

export type UserPresenceState = UserPresence

export interface MultiplayerAuthPayload {
  token?: string
  sceneId: string
  userId: string
  name: string
  role: ClientRole
}

export type MultiplayerConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}
