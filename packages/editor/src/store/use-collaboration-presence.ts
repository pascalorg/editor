'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { create } from 'zustand'

export type CollaborationCursor = { x: number; y: number }

export type CollaborationParticipant = {
  actorId: string
  color: string
  cursor: CollaborationCursor | null
  lastSeenAt: string
  name: string
  selectedIds: AnyNodeId[]
}

type CollaborationPresenceState = {
  connected: boolean
  localActorId: string | null
  participants: Record<string, CollaborationParticipant>
  conflict: string | null
  setConnected: (connected: boolean) => void
  setLocalActorId: (actorId: string | null) => void
  setParticipants: (participants: CollaborationParticipant[]) => void
  setConflict: (conflict: string | null) => void
  reset: () => void
}

const useCollaborationPresence = create<CollaborationPresenceState>((set) => ({
  connected: false,
  localActorId: null,
  participants: {},
  conflict: null,
  setConnected: (connected) => set({ connected }),
  setLocalActorId: (localActorId) => set({ localActorId }),
  setParticipants: (participants) =>
    set({
      participants: Object.fromEntries(
        participants.map((participant) => [participant.actorId, participant]),
      ),
    }),
  setConflict: (conflict) => set({ conflict }),
  reset: () => set({ connected: false, localActorId: null, participants: {}, conflict: null }),
}))

export default useCollaborationPresence
