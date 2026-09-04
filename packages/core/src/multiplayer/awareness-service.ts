import * as awarenessProtocol from 'y-protocols/awareness'
import useLiveTransforms from '../store/use-live-transforms'
import type {
  UserPresence,
  UserCursor,
  UserSelection,
  UserActiveDrag,
  AwarenessChange,
} from './types'

export interface AwarenessServiceOptions {
  awareness: awarenessProtocol.Awareness
  localPresence: UserPresence
  throttleMs?: number // Default: 33ms (~30Hz)
}

export class MultiplayerAwarenessService {
  private awareness: awarenessProtocol.Awareness
  private throttleMs: number
  private pendingLocalState: Partial<UserPresence> = {}
  private throttleTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(presences: Map<number, UserPresence>) => void>()
  private prevActiveDrags = new Map<number, string>() // clientId -> nodeId

  constructor({ awareness, localPresence, throttleMs = 33 }: AwarenessServiceOptions) {
    this.awareness = awareness
    this.throttleMs = throttleMs

    // Initialize local state
    this.awareness.setLocalState({
      ...localPresence,
      lastActive: Date.now(),
    })

    this.awareness.on('change', this.handleAwarenessChange)
  }

  private handleAwarenessChange = ({ added, updated, removed }: AwarenessChange) => {
    const states = this.getPresences()
    const localClientId = this.awareness.clientID

    // 1. Handle Active Drag Decoupling -> useLiveTransforms
    // For removed or updated clients, check if drag was cleared
    for (const clientId of [...added, ...updated]) {
      if (clientId === localClientId) continue
      const presence = states.get(clientId)
      const prevNodeId = this.prevActiveDrags.get(clientId)

      if (presence?.activeDrag) {
        const { nodeId, position, rotation, supportElevationCap } = presence.activeDrag
        if (prevNodeId && prevNodeId !== nodeId) {
          useLiveTransforms.getState().clear(prevNodeId)
        }
        useLiveTransforms.getState().set(nodeId, {
          position,
          rotation: rotation ?? 0,
          supportElevationCap,
        })
        this.prevActiveDrags.set(clientId, nodeId)
      } else if (prevNodeId) {
        useLiveTransforms.getState().clear(prevNodeId)
        this.prevActiveDrags.delete(clientId)
      }
    }

    for (const clientId of removed) {
      if (clientId === localClientId) continue
      const prevNodeId = this.prevActiveDrags.get(clientId)
      if (prevNodeId) {
        useLiveTransforms.getState().clear(prevNodeId)
        this.prevActiveDrags.delete(clientId)
      }
    }

    // 2. Notify subscribers
    for (const listener of this.listeners) {
      try {
        listener(states)
      } catch (err) {
        console.error('[AwarenessService] Listener error:', err)
      }
    }
  }

  public getPresences(): Map<number, UserPresence> {
    const states = new Map<number, UserPresence>()
    this.awareness.getStates().forEach((state, clientId) => {
      if (state && typeof state === 'object' && 'userId' in state) {
        states.set(clientId, state as UserPresence)
      }
    })
    return states
  }

  public subscribe(listener: (presences: Map<number, UserPresence>) => void): () => void {
    this.listeners.add(listener)
    listener(this.getPresences())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public setLocalState(patch: Partial<UserPresence>): void {
    this.pendingLocalState = {
      ...this.pendingLocalState,
      ...patch,
      lastActive: Date.now(),
    }

    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.flushLocalState()
      }, this.throttleMs)
    }
  }

  public flushLocalState(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
      this.throttleTimer = null
    }

    const current = (this.awareness.getLocalState() || {}) as UserPresence
    const next = {
      ...current,
      ...this.pendingLocalState,
    }
    this.pendingLocalState = {}
    this.awareness.setLocalState(next)
  }

  public setLocalCursor(cursor: UserCursor | null): void {
    this.setLocalState({ cursor })
  }

  public setLocalSelection(selectedNodeIds: string[]): void {
    this.setLocalState({ selection: { selectedNodeIds } })
  }

  public setLocalActiveDrag(activeDrag: UserActiveDrag | null): void {
    this.setLocalState({ activeDrag })
  }

  public clearLocalActiveDrag(): void {
    this.setLocalState({ activeDrag: null })
    this.flushLocalState()
  }

  public destroy(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
      this.throttleTimer = null
    }
    this.awareness.off('change', this.handleAwarenessChange)
    this.listeners.clear()

    // Clean up any remaining live transforms from remote users
    for (const nodeId of this.prevActiveDrags.values()) {
      useLiveTransforms.getState().clear(nodeId)
    }
    this.prevActiveDrags.clear()
  }
}
