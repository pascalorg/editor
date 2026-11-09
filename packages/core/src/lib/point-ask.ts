import { create } from 'zustand'
import type { PointAskSubmit, PointAskSubmitResult } from '../agent-operations/point-context'

// The door between Point and ask's scene side and whoever answers it (the hosted chat). The open
// source editor has no chat, so the mode is offered only while a host has registered a handler:
// `useHasPointAskHandler` drives the toolbar button and the C key.

export type PointAskHandler = (submit: PointAskSubmit) => Promise<PointAskSubmitResult>

const useHandlerStore = create<{ handler: PointAskHandler | null }>(() => ({ handler: null }))

/** The chat registers on mount; the returned function unregisters it (only its own registration). */
export function registerPointAskHandler(handler: PointAskHandler): () => void {
  useHandlerStore.setState({ handler })
  return () => {
    if (useHandlerStore.getState().handler === handler) useHandlerStore.setState({ handler: null })
  }
}

export function useHasPointAskHandler(): boolean {
  return useHandlerStore((state) => state.handler !== null)
}

export function hasPointAskHandler(): boolean {
  return useHandlerStore.getState().handler !== null
}

/** Hands an ask to the registered handler; with none, the person is told it is unavailable. */
export async function submitPointAsk(submit: PointAskSubmit): Promise<PointAskSubmitResult> {
  const handler = useHandlerStore.getState().handler
  if (!handler)
    return {
      ok: false,
      code: 'unavailable',
      message: 'Point and ask needs the chat, which is not available here.',
    }
  try {
    return await handler(submit)
  } catch (error) {
    return {
      ok: false,
      code: 'error',
      message: error instanceof Error ? error.message : 'Pascal could not take this ask.',
    }
  }
}
