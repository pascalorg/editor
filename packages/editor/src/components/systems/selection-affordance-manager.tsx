'use client'

import {
  type AnyNodeId,
  createSceneApi,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, Suspense, useMemo } from 'react'
import { getRegistryAffordanceTool } from '../tools/shared/affordance-dispatch'
import type {
  SelectionAffordanceHistoryApi,
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
  const selectedNode = useScene((s) => {
    if (selectedIds.length !== 1) return null
    return s.nodes[selectedIds[0] as AnyNodeId] ?? null
  })
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

  const Component = useMemo<ComponentType<SelectionAffordanceProps> | null>(() => {
    if (!selectedNode) return null
    return getRegistryAffordanceTool(selectedNode.type, 'selection')
  }, [selectedNode])

  if (!(Component && selectedNode)) return null
  return (
    <Suspense fallback={null}>
      <Component
        historyApi={historyApi}
        node={selectedNode}
        readOnly={readOnly}
        sceneApi={sceneApi}
      />
    </Suspense>
  )
}
