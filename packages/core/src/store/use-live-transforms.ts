// Ephemeral live transform state for nodes being actively dragged/moved.
// This decouples 2D (floorplan) and 3D (viewer) so neither needs to peek
// into the other's scene graph during drag operations.

import { create } from 'zustand'

export type LiveTransform = {
  position: [number, number, number]
  rotation: number // Y-axis rotation (plan-view rotation)
}

type LiveTransformState = {
  transforms: Map<string, LiveTransform>
  set(nodeId: string, transform: LiveTransform): void
  get(nodeId: string): LiveTransform | undefined
  clear(nodeId: string): void
  clearAll(): void
}

function sameLiveTransform(a: LiveTransform | undefined, b: LiveTransform): boolean {
  return (
    !!a &&
    a.rotation === b.rotation &&
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.position[2] === b.position[2]
  )
}

const useLiveTransforms = create<LiveTransformState>((set, get) => ({
  transforms: new Map(),
  set: (nodeId, transform) =>
    set((state) => {
      if (sameLiveTransform(state.transforms.get(nodeId), transform)) return state
      const next = new Map(state.transforms)
      next.set(nodeId, transform)
      return { transforms: next }
    }),
  get: (nodeId) => get().transforms.get(nodeId),
  clear: (nodeId) =>
    set((state) => {
      if (!state.transforms.has(nodeId)) return state
      const next = new Map(state.transforms)
      next.delete(nodeId)
      return { transforms: next }
    }),
  clearAll: () => set({ transforms: new Map() }),
}))

export default useLiveTransforms
