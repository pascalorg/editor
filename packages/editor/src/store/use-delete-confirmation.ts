import type { DeleteZonePayload } from '@pascal-app/core'
import { create } from 'zustand'

/** Changing one of a room's construction parts, with what it takes along. */
export type RoomConstructionChange = {
  part: 'floor' | 'walls' | 'ceiling'
  /** Walls can be confirmed on the way in too; everything else asks on removal. */
  action?: 'add' | 'remove'
  roomName: string
  /**
   * Walls: hosted openings and objects removed with them. Ceiling: items
   * hanging from it. Floor: items standing on it.
   */
  hostedIds: string[]
  /** Walls turned into separators, or built on them. */
  wallCount?: number
  sharedWalls?: boolean
  /** Walls added: clear floor area the room gives up to them, m². */
  areaLoss?: number
  /** Ceiling: names of the hand-drawn ceilings removed ('' when unnamed). */
  manualCeilings?: string[]
  /** Ceiling: other rooms those hand-drawn ceilings also cover. */
  alsoCovers?: string[]
}

export type DeleteConfirmationRequest = {
  room?: DeleteZonePayload
  construction?: RoomConstructionChange
  conflict?: string
  onKeepContents?: () => void
  count: number
  onConfirm: () => void
}

type DeleteConfirmationStore = {
  request: DeleteConfirmationRequest | null
  cancel: () => void
  confirm: () => void
  requestConfirmation: (request: DeleteConfirmationRequest) => void
}

const useDeleteConfirmation = create<DeleteConfirmationStore>((set, get) => ({
  request: null,
  cancel: () => set({ request: null }),
  confirm: () => {
    const request = get().request
    if (!request) return
    set({ request: null })
    request.onConfirm()
  },
  requestConfirmation: (request) => set({ request }),
}))

export default useDeleteConfirmation
