import { create } from 'zustand'
export const useHandleGroup = create<{ active: { nodeId: string; group: string } | null }>(() => ({
  active: null,
}))
