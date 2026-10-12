'use client'
import { type AnyNodeId, type SlabFeatureNode, type SlabNode, useScene } from '@pascal-app/core'
import {
  ActionMenuButton,
  activeViewLayout,
  useEditor,
  useInteractionScope,
  VIEW_2D,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Box, PanelTop } from 'lucide-react'
import { createSlabFeatureDraft } from './placement'

export function startSlabFeaturePlacement(
  host: SlabNode | SlabFeatureNode,
  mode: SlabFeatureNode['mode'],
) {
  if (useScene.getState().readOnly) return
  const node = createSlabFeatureDraft(useScene.getState().nodes, host.id, mode)
  const layout = activeViewLayout(useEditor.getState())
  useInteractionScope.getState().begin({
    kind: 'placing',
    node,
    nodeId: node.id,
    nodeType: node.type,
    view: layout.panes[layout.focus] === VIEW_2D ? '2d' : '3d',
    pressDrag: false,
    driver: 'registry-tool',
  })
  useEditor.getState().setTool('slab-feature')
}
export default function SlabFeatureActions() {
  const ids = useViewer((s) => s.selection.selectedIds)
  const host = useScene((s) => {
    const hosts = ids
      .map((id) => s.nodes[id as AnyNodeId])
      .filter((node) => node?.type === 'slab' || node?.type === 'slab-feature')
    return hosts.length === 1 ? hosts[0] : undefined
  })
  const readOnly = useScene((s) => s.readOnly)
  if (host?.type !== 'slab' && host?.type !== 'slab-feature') return null
  if (host.type === 'slab-feature' && host.mode !== 'bump') return null
  return (
    <>
      {(['niche', 'bump'] as const)
        .filter((mode) => host.type === 'slab' || mode === 'niche')
        .map((mode) => {
          let reason: string | undefined
          try {
            createSlabFeatureDraft(useScene.getState().nodes, host.id, mode)
          } catch (err) {
            reason = err instanceof Error ? err.message : 'Feature unavailable.'
          }
          return (
            <ActionMenuButton
              key={mode}
              label={`Add ${mode}`}
              disabled={readOnly || !!reason}
              disabledReason={reason}
              onClick={(event) => {
                event.stopPropagation()
                startSlabFeaturePlacement(host, mode)
              }}
            >
              {mode === 'bump' ? <Box className="size-4" /> : <PanelTop className="size-4" />}
            </ActionMenuButton>
          )
        })}
    </>
  )
}
