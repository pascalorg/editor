'use client'

import { nodeRegistry, type ToolHint, useRegistryVersion } from '@pascal-app/core'
import { useMemo, useSyncExternalStore } from 'react'
import useEditor from '../store/use-editor'

export type PanelToolOption = {
  id: string
  label: string
  value: string
  choices: readonly { value: string; label: string; description?: string }[]
  set: (value: string) => void
}

export function createToolHintsStore(hints: readonly ToolHint[]) {
  return {
    subscribe(listener: () => void) {
      const subscriptions = hints.flatMap((hint) => [hint.chip?.subscribe, hint.visible?.subscribe])
      const cleanups = [...new Set(subscriptions)].flatMap((subscribe) =>
        subscribe ? [subscribe(listener)] : [],
      )
      return () => cleanups.forEach((cleanup) => cleanup())
    },
    getSnapshot: () =>
      JSON.stringify(hints.map((hint) => [hint.visible?.value() ?? true, hint.chip?.value()])),
  }
}

export function useVisibleToolHints(hints: readonly ToolHint[] = []) {
  const draftVertexCount = useEditor((state) => state.draftVertexCount)
  const store = useMemo(() => createToolHintsStore(hints), [hints])
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return hints.filter(
    (hint) =>
      !(hint.key === 'Shift' && hint.label === 'Cycle snapping mode') &&
      (hint.visible?.value() ?? true) &&
      (hint.minDraftVertices == null || draftVertexCount >= hint.minDraftVertices),
  )
}

export function usePanelToolHints(kind: string | null | undefined) {
  useRegistryVersion()
  return useVisibleToolHints(kind ? nodeRegistry.get(kind)?.toolHints : undefined)
}
