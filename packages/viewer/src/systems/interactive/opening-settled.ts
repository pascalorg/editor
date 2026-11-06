import { emitter } from '@pascal-app/core'

/** Longer than any built-in leaf, sash or shutter run, so a missed event never strands a sound. */
const FALLBACK_MS = 2000

/**
 * Resolves when a built-in door's leaf or a window's sash (or, with `shutters`,
 * its shutters) finishes the run just started, so the latch can sound on the
 * frame the leaf lands.
 */
export function openingSettled(
  node: { id: string; type: string },
  part: 'leaf' | 'shutters' = 'leaf',
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      emitter.off('door:animation-completed', onDoor)
      emitter.off('window:animation-completed', onWindow)
      resolve()
    }
    const onDoor = (event: { doorId: string }) => {
      if (node.type === 'door' && event.doorId === node.id) done()
    }
    const onWindow = (event: { windowId: string; field: string }) => {
      if (node.type !== 'window' || event.windowId !== node.id) return
      if ((event.field === 'operationState') === (part === 'leaf')) done()
    }
    const timer = setTimeout(done, FALLBACK_MS)
    emitter.on('door:animation-completed', onDoor)
    emitter.on('window:animation-completed', onWindow)
  })
}
