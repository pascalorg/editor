'use client'

import { type AnyNode, type BoxNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  NodeMaterialSection,
  PanelSection,
  PanelWrapper,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { L, S } from '../i18n/panel-labels'
import { DataBindingSection } from '../shared/data-binding-section'
import { TransformPanelSection } from '../shared/transform-panel-section'

export default function BoxPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as BoxNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<BoxNode>) => {
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

  if (!(node && node.type === 'box' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/cube.png"
      onClose={handleClose}
      title={node.name || 'Box'}
      width={300}
    >
      <PanelSection title={S.dimensions()}>
        <MetricControl
          label={L.length()}
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ length: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.length ?? 1) * 100) / 100}
        />
        <MetricControl
          label={L.width()}
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ width: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.width ?? 1) * 100) / 100}
        />
        <MetricControl
          label={L.height()}
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ height: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.height ?? 1) * 100) / 100}
        />
        <MetricControl
          label="Corner radius"
          max={Math.max(0, Math.min(node.length ?? 1, node.width ?? 1, node.height ?? 1) / 2)}
          min={0}
          onChange={(value) => handleUpdate({ cornerRadius: value })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round((node.cornerRadius ?? 0) * 100) / 100}
        />
      </PanelSection>

      <NodeMaterialSection />
      <TransformPanelSection
        includePlanarPosition
        node={node}
        nodeId={selectedId as AnyNode['id']}
        onUpdate={handleUpdate}
      />
      <DataBindingSection node={node} onUpdate={handleUpdate} />

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
