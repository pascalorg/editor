'use client'

import { type AnyNode, type RoundedPanelNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  NodeMaterialSection,
  PanelSection,
  PanelWrapper,
  triggerSFX,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { L, S } from '../i18n/panel-labels'
import { TransformPanelSection } from '../shared/transform-panel-section'

export default function RoundedPanelPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoundedPanelNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<RoundedPanelNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )
  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNode['id'])
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNode['id'])
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'rounded-panel' && selectedId && selectedCount === 1)) return null

  const maxCornerRadius = Math.max(0, Math.min(node.length ?? 1, node.width ?? 0.5) / 2)

  return (
    <PanelWrapper
      icon="/icons/cube.webp"
      onClose={handleClose}
      title={node.name || '\u5706\u89d2\u9762\u677f'}
      width={300}
    >
      <PanelSection title={S.dimensions()}>
        <MetricControl
          label={L.length()}
          max={20}
          min={0.01}
          onChange={(value) => handleUpdate({ length: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.length ?? 1) * 100) / 100}
        />
        <MetricControl
          label={L.width()}
          max={20}
          min={0.01}
          onChange={(value) => handleUpdate({ width: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.width ?? 0.5) * 100) / 100}
        />
        <MetricControl
          label={L.thickness()}
          max={2}
          min={0.005}
          onChange={(value) => handleUpdate({ thickness: value })}
          precision={3}
          step={0.005}
          unit="m"
          value={Math.round((node.thickness ?? 0.04) * 1000) / 1000}
        />
        <MetricControl
          label={L.cornerRadius()}
          max={maxCornerRadius}
          min={0}
          onChange={(value) => handleUpdate({ cornerRadius: value })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round((node.cornerRadius ?? 0.04) * 100) / 100}
        />
        <MetricControl
          label="\u5706\u89d2\u7ec6\u5206"
          max={12}
          min={1}
          onChange={(value) => handleUpdate({ cornerSegments: Math.round(value) })}
          precision={0}
          step={1}
          value={Math.round(node.cornerSegments ?? 4)}
        />
      </PanelSection>

      <NodeMaterialSection />
      <TransformPanelSection
        node={node}
        nodeId={selectedId as AnyNode['id']}
        onUpdate={handleUpdate}
      />

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={L.delete()}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
