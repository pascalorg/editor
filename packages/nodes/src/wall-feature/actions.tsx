'use client'
import {
  type AnyNodeId,
  type WallFeatureNode as Feature,
  isCurvedWall,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  ActionMenuButton,
  activeViewLayout,
  useEditor,
  useInteractionScope,
  VIEW_2D,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Box, PanelTop } from 'lucide-react'
import { useMemo } from 'react'
import { createWallFeatureDraft } from './placement'

export function startWallFeaturePlacement(host: WallNode | Feature, mode: Feature['mode']) {
  if (useScene.getState().readOnly) return
  if (host.type === 'wall' && (isCurvedWall(host) || host.wallType === 'curtain')) return
  if (host.type === 'wall-feature' && (host.mode !== 'bump' || mode !== 'niche')) return
  let node: Feature
  try {
    node = createWallFeatureDraft(useScene.getState().nodes, host.id, mode)
  } catch {
    return
  }
  const layout = activeViewLayout(useEditor.getState())
  const view = layout.panes[layout.focus] === VIEW_2D ? '2d' : '3d'
  useInteractionScope.getState().begin({
    kind: 'placing',
    node,
    nodeId: node.id,
    nodeType: node.type,
    view,
    pressDrag: false,
    driver: 'registry-tool',
  })
  useEditor.getState().setTool('wall-feature')
}
export default function WallFeatureActions() {
  const ids = useViewer((s) => s.selection.selectedIds)
  const host = useScene((s) => (ids.length === 1 ? s.nodes[ids[0] as AnyNodeId] : undefined))
  const nodes = useScene((s) => s.nodes)
  const reasons = useMemo(
    () =>
      Object.fromEntries(
        (['niche', 'bump'] as const).map((mode) => {
          if (host?.type !== 'wall' && host?.type !== 'wall-feature') return [mode, null]
          try {
            createWallFeatureDraft(nodes, host.id, mode)
            return [mode, null]
          } catch (error) {
            return [mode, error instanceof Error ? error.message : 'Feature unavailable.']
          }
        }),
      ),
    [nodes, host],
  )
  const readOnly = useScene((s) => s.readOnly)
  if (host?.type !== 'wall' && host?.type !== 'wall-feature') return null
  if (host.type === 'wall-feature' && host.mode !== 'bump') return null
  const disabled =
    readOnly || (host.type === 'wall' && (isCurvedWall(host) || host.wallType === 'curtain'))
  return (
    <>
      <ActionMenuButton
        label="Add niche"
        disabled={disabled || !!reasons.niche}
        disabledReason={reasons.niche ?? undefined}
        onClick={(event) => {
          event.stopPropagation()
          startWallFeaturePlacement(host, 'niche')
        }}
      >
        <PanelTop className="size-4" />
      </ActionMenuButton>
      {host.type === 'wall' && (
        <ActionMenuButton
          label="Add bump"
          disabled={disabled || !!reasons.bump}
          disabledReason={reasons.bump ?? undefined}
          onClick={(event) => {
            event.stopPropagation()
            startWallFeaturePlacement(host, 'bump')
          }}
        >
          <Box className="size-4" />
        </ActionMenuButton>
      )}
    </>
  )
}
