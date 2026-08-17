'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, Suspense, useMemo } from 'react'
import { useIsNodeIdEditLocked } from '../../lib/edit-lock'
import { getRegistryAffordanceTool } from '../tools/shared/affordance-dispatch'

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
  const selectedKind = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  // A locked node's drag-to-edit affordances (duct/pipe path points, etc.) do
  // not mount; it stays selectable and inspectable.
  const editLocked = useIsNodeIdEditLocked(selectedId)

  const Component = useMemo<ComponentType | null>(() => {
    if (!selectedKind) return null
    return getRegistryAffordanceTool(selectedKind, 'selection')
  }, [selectedKind])

  if (!Component || editLocked) return null
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  )
}
