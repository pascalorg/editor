export type ScenePresenceParticipant = {
  actorId: string
  color: string
  cursor: { x: number; y: number } | null
  lastSeenAt: string
  name: string
  selectedIds: string[]
}

type PresenceListener = (participants: ScenePresenceParticipant[]) => void

const PRESENCE_TTL_MS = 15_000

export class ScenePresenceHub {
  readonly #rooms = new Map<string, Map<string, ScenePresenceParticipant>>()
  readonly #listeners = new Map<string, Set<PresenceListener>>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  hasRoom(sceneId: string): boolean {
    return this.#rooms.has(sceneId) || this.#listeners.has(sceneId)
  }

  upsert(
    sceneId: string,
    participant: Omit<ScenePresenceParticipant, 'lastSeenAt'>,
  ): ScenePresenceParticipant[] {
    const room = this.#rooms.get(sceneId) ?? new Map<string, ScenePresenceParticipant>()
    room.set(participant.actorId, {
      ...structuredClone(participant),
      lastSeenAt: new Date(this.#now()).toISOString(),
    })
    this.#rooms.set(sceneId, room)
    return this.#publish(sceneId)
  }

  remove(sceneId: string, actorId: string): ScenePresenceParticipant[] {
    this.#rooms.get(sceneId)?.delete(actorId)
    return this.#publish(sceneId)
  }

  snapshot(sceneId: string): ScenePresenceParticipant[] {
    this.#prune(sceneId)
    return [...(this.#rooms.get(sceneId)?.values() ?? [])]
      .sort((left, right) => left.actorId.localeCompare(right.actorId))
      .map((participant) => structuredClone(participant))
  }

  subscribe(sceneId: string, listener: PresenceListener): () => void {
    const listeners = this.#listeners.get(sceneId) ?? new Set<PresenceListener>()
    listeners.add(listener)
    this.#listeners.set(sceneId, listeners)
    try {
      listener(this.snapshot(sceneId))
    } catch (error) {
      console.error('[presence] listener failed', error)
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(sceneId)
    }
  }

  #prune(sceneId: string): void {
    const room = this.#rooms.get(sceneId)
    if (!room) return
    const staleBefore = this.#now() - PRESENCE_TTL_MS
    for (const [actorId, participant] of room) {
      if (Date.parse(participant.lastSeenAt) < staleBefore) room.delete(actorId)
    }
    if (room.size === 0) this.#rooms.delete(sceneId)
  }

  #publish(sceneId: string): ScenePresenceParticipant[] {
    const participants = this.snapshot(sceneId)
    for (const listener of this.#listeners.get(sceneId) ?? []) {
      try {
        listener(participants)
      } catch (error) {
        console.error('[presence] listener failed', error)
      }
    }
    return participants
  }
}

const GLOBAL_PRESENCE_HUB = Symbol.for('pascal.scene-presence-hub')
const globalPresence = globalThis as typeof globalThis & {
  [GLOBAL_PRESENCE_HUB]?: ScenePresenceHub
}

export function getScenePresenceHub(): ScenePresenceHub {
  globalPresence[GLOBAL_PRESENCE_HUB] ??= new ScenePresenceHub()
  return globalPresence[GLOBAL_PRESENCE_HUB]
}
