'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, Suspense, useMemo } from 'react'
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
  const selectedKind = useScene((s) => {
    if (selectedIds.length !== 1) return null
    return s.nodes[selectedIds[0] as AnyNodeId]?.type ?? null
  })

  const Component = useMemo<ComponentType | null>(() => {
    if (!selectedKind) return null
    return getRegistryAffordanceTool(selectedKind, 'selection')
  }, [selectedKind])

  if (!Component) return null
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  )
}
