import { type AnyNodeId, emitter, useInteractive } from '@pascal-app/core'

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

/** Recipe timelines run longer than a door leaf; past this, a lost event still frees the sound. */
const MOTION_FALLBACK_MS = 6000

/**
 * Resolves when a procedural item's latest commanded run (a cabinet door, a
 * drawer, a lid) has its moving parts at rest. Call it right after the toggle.
 */
export function proceduralSettled(nodeId: AnyNodeId): Promise<void> {
  const sequence = useInteractive.getState().procedural[nodeId]?.motionCommand?.sequence ?? 0
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      emitter.off('procedural:motion-settled', onSettled)
      resolve()
    }
    const onSettled = (event: { nodeId: string; sequence: number }) => {
      if (event.nodeId === nodeId && event.sequence >= sequence) done()
    }
    const timer = setTimeout(done, MOTION_FALLBACK_MS)
    emitter.on('procedural:motion-settled', onSettled)
  })
}
