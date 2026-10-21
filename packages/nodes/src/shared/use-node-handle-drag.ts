import {
  type AnyNode,
  type AnyNodeId,
  beginSceneHistoryPauseSession,
  emitter,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { swallowNextClick, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef } from 'react'

type NodeUpdate = { id: AnyNodeId; data: Partial<AnyNode> }
type HandleDragOptions = {
  nodeId: AnyNodeId
  handle: string
  cursor: string
  onMove: (event: PointerEvent, preview: (updates: NodeUpdate[]) => void) => void
  commitUpdates?: (updates: NodeUpdate[]) => NodeUpdate[]
  onEnd: () => void
}

/** One pointer gesture owns its overrides, listeners, scope and history lease. */
export function useNodeHandleDrag(nodeId: AnyNodeId) {
  const cancelRef = useRef<(() => void) | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the selected node must cancel the previous node's gesture.
  useEffect(() => () => cancelRef.current?.(), [nodeId])

  return useCallback((options: HandleDragOptions) => {
    cancelRef.current?.()
    const scope = { kind: 'handle-drag' as const, nodeId: options.nodeId, handle: options.handle }
    useInteractionScope.getState().begin(scope)
    const gesture = useInteractionScope.getState().gesture
    const history = beginSceneHistoryPauseSession(useScene)
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = options.cursor
    useViewer.getState().setInputDragging(true)
    let finished = false
    let latest: NodeUpdate[] = []
    const fields = new Map<AnyNodeId, string[]>()

    const clear = (id: AnyNodeId, keys: string[]) => {
      useLiveNodeOverrides.getState().clearFields(id, keys)
      if (useScene.getState().nodes[id]) useScene.getState().markDirty(id)
    }
    const preview = (updates: NodeUpdate[]) => {
      if (finished) return
      latest = updates.filter(({ id }) => !!useScene.getState().nodes[id])
      const next = new Map(latest.map(({ id, data }) => [id, Object.keys(data)]))
      for (const [id, keys] of fields) {
        const removed = keys.filter((key) => !next.get(id)?.includes(key))
        if (removed.length) clear(id, removed)
      }
      fields.clear()
      for (const [id, keys] of next) fields.set(id, keys)
      useLiveNodeOverrides.getState().setMany(latest.map(({ id, data }) => [id, data]))
      for (const { id } of latest) useScene.getState().markDirty(id)
    }
    const finish = (commit: boolean) => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      emitter.off('tool:cancel', onCancel)
      unsubscribeScope()
      cancelRef.current = null
      swallowNextClick()
      try {
        const nodes = useScene.getState().nodes
        const changed = latest.filter(({ id, data }) => {
          const node = nodes[id]
          return (
            node &&
            Object.entries(data).some(
              ([key, value]) =>
                JSON.stringify((node as Record<string, unknown>)[key]) !== JSON.stringify(value),
            )
          )
        })
        if (commit && changed.length) {
          const updates = options.commitUpdates?.(changed) ?? changed
          history.commitStep(() => useScene.getState().updateNodes(updates))
        }
      } finally {
        for (const [id, keys] of fields) clear(id, keys)
        history.end()
        useViewer.getState().setInputDragging(false)
        if (document.body.style.cursor === options.cursor)
          document.body.style.cursor = previousCursor
        if (useInteractionScope.getState().gesture === gesture) useInteractionScope.getState().end()
        options.onEnd()
      }
    }
    const onMove = (event: PointerEvent) => options.onMove(event, preview)
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    const unsubscribeScope = useInteractionScope.subscribe((state) => {
      if (state.gesture !== gesture) onCancel()
    })
    cancelRef.current = onCancel
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    window.addEventListener('keydown', onKeyDown)
    emitter.on('tool:cancel', onCancel)
  }, [])
}
