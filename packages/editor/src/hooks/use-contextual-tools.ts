import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useEditor, { type StructureTool } from '../store/use-editor'

export function useContextualTools() {
  const selection = useViewer((s) => s.selection)
  // Only resubscribe when the *types* of selected nodes change, not when any
  // node in the scene mutates.
  const selectedTypes = useScene(
    useShallow((s) =>
      selection.selectedIds.map((id) => s.nodes[id as AnyNodeId]?.type).filter(Boolean),
    ),
  )
  const structureLayer = useEditor((s) => s.structureLayer)

  return useMemo(() => {
    // If we are in the zones layer, only zone tool is relevant
    if (structureLayer === 'zones') {
      return ['zone'] as StructureTool[]
    }

    // Default tools when nothing is selected
    const defaultTools: StructureTool[] = [
      'wall',
      'fence',
      'slab',
      'ceiling',
      'roof',
      'door',
      'window',
    ]

    if (selectedTypes.length === 0) {
      return defaultTools
    }

    // If a wall is selected, prioritize wall-hosted elements
    if (selectedTypes.includes('wall')) {
      return ['window', 'door', 'wall', 'fence'] as StructureTool[]
    }

    // If a slab is selected, prioritize slab editing
    if (selectedTypes.includes('slab')) {
      return ['slab', 'wall'] as StructureTool[]
    }

    // If a ceiling is selected, prioritize ceiling editing
    if (selectedTypes.includes('ceiling')) {
      return ['ceiling'] as StructureTool[]
    }

    // If a roof is selected, prioritize roof editing
    if (selectedTypes.includes('roof')) {
      return ['roof'] as StructureTool[]
    }

    return defaultTools
  }, [selectedTypes, structureLayer])
}
