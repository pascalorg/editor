import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import useEditor, { type StructureTool } from '@/store/use-editor'

export function useContextualTools() {
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  const phase = useEditor((s) => s.phase)
  const structureLayer = useEditor((s) => s.structureLayer)

  return useMemo(() => {
    // If we are in the zones layer, only zone tool is relevant
    if (structureLayer === 'zones') {
      return ['zone'] as StructureTool[]
    }

    // Default tools when nothing is selected
    const defaultTools: StructureTool[] = ['wall', 'slab', 'ceiling', 'roof', 'door', 'window']

    if (selection.selectedIds.length === 0) {
      return defaultTools
    }

    // Get types of selected nodes
    const selectedTypes = new Set(
      selection.selectedIds
        .map((id) => nodes[id as AnyNodeId]?.type)
        .filter(Boolean)
    )

    // If a wall is selected, prioritize wall-hosted elements
    if (selectedTypes.has('wall')) {
      return ['window', 'door', 'wall'] as StructureTool[]
    }

    // If a slab is selected, prioritize slab editing
    if (selectedTypes.has('slab')) {
      return ['slab', 'wall'] as StructureTool[]
    }

    // If a ceiling is selected, prioritize ceiling editing
    if (selectedTypes.has('ceiling')) {
      return ['ceiling'] as StructureTool[]
    }

    // If a roof is selected, prioritize roof editing
    if (selectedTypes.has('roof')) {
      return ['roof'] as StructureTool[]
    }

    return defaultTools
  }, [selection.selectedIds, nodes, structureLayer])
}
