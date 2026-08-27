'use client'

import {
  type AnyNodeId,
  createSceneApi,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, Suspense, useMemo } from 'react'
import { useIsNodeIdEditLocked } from '../../lib/edit-lock'
import { getRegistryAffordanceTool } from '../tools/shared/affordance-dispatch'
import type {
  SelectionAffordanceHistoryApi,
  SelectionAffordanceInteractionApi,
  SelectionAffordanceProps,
} from './selection-affordance-services'

/**
 * Editor-mounted dispatcher for a kind's selection-time editing UI.
 *
 * Some kinds expose drag-to-edit affordances that should appear only
 * while a single node of that kind is selected — duct / pipe / lineset
 * path-point handles, fitting Alt-axis-cycling listeners. These read
 * `useEditor` (grid snap step, rotation axis) and render the editor's
 * `DimensionPill`, so they must NOT ride in `def.system` (which the
 * viewer package mounts for the read-only route). The kind declares the
 * component under `def.affordanceTools.selection` and this manager —
 * mounted inside the editor only — loads it for the selected kind.
 */
export function SelectionAffordanceManager() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] as AnyNodeId) : null
  const selectedNode = useScene((s) => {
    if (!selectedId) return null
    return s.nodes[selectedId] ?? null
  })
  const editLocked = useIsNodeIdEditLocked(selectedId)
  const readOnly = useScene((s) => s.readOnly)
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const historyApi = useMemo<SelectionAffordanceHistoryApi>(
    () => ({
      depth: () => useScene.temporal.getState().pastStates.length,
      replaceLatest: (expectedDepth, replace) => {
        if (useScene.temporal.getState().pastStates.length !== expectedDepth) return false
        let replaced = false
        runAsSingleSceneHistoryStep(useScene, () => {
          useScene.temporal.getState().undo()
          replaced = replace()
          if (!replaced) useScene.temporal.getState().redo()
        })
        return replaced
      },
    }),
    [],
  )
  const interactionApi = useMemo<SelectionAffordanceInteractionApi>(
    () => ({
      beginInputDrag: () => {
        const previous = useViewer.getState().inputDragging
        let restored = false
        useViewer.getState().setInputDragging(true)
        return () => {
          if (restored) return
          restored = true
          useViewer.getState().setInputDragging(previous)
        }
      },
      clearSelection: () => useViewer.getState().setSelection({ selectedIds: [] }),
    }),
    [],
  )

  const Component = useMemo<ComponentType<SelectionAffordanceProps> | null>(() => {
    if (!selectedNode) return null
    return getRegistryAffordanceTool(selectedNode.type, 'selection')
  }, [selectedNode])

  if (!(Component && selectedNode) || editLocked) return null
  return (
    <Suspense fallback={null}>
      <Component
        historyApi={historyApi}
        interactionApi={interactionApi}
        node={selectedNode}
        readOnly={readOnly}
        sceneApi={sceneApi}
      />
    </Suspense>
  )
}
