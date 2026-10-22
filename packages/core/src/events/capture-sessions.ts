import { emitter } from './bus'

/**
 * The capture sessions on now (`camera-controls:capture-session`: a sheet's pictures, an agent's
 * view), counted by owner: one is on from the first owner's start to the last owner's end, however
 * the runs overlap. Counted from the moment core loads, before anything can emit, so whatever draws
 * the scene reads the same answer, mounted before a session or during one: the editor's finished
 * presentation, a plugin's own finished view (Bones' X-ray).
 */
const owners = new Set<string>()
const listeners = new Set<() => void>()

emitter.on('camera-controls:capture-session', ({ owner, active }) => {
  if (!owner) return
  const before = owners.size > 0
  if (active) owners.add(owner)
  else owners.delete(owner)
  if (before !== owners.size > 0) for (const listener of listeners) listener()
})

/** Whether a capture session is on now: the pictures show the finished house. */
export const isCaptureSessionOn = (): boolean => owners.size > 0

/** Calls `listener` when the first session starts and when the last one ends. */
export function subscribeCaptureSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
