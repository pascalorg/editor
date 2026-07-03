'use client'

import { type AnyNode, type CylinderNode, useScene } from '@pascal-app/core'
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

export default function CylinderPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as CylinderNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<CylinderNode>) => {
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

  if (!(node && node.type === 'cylinder' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/cube.webp"
      onClose={handleClose}
      title={node.name || '\u5706\u67f1'}
      width={300}
    >
      <PanelSection title={S.dimensions()}>
        <MetricControl
          label={'\u534a\u5f84'}
          max={10}
          min={0.1}
          onChange={(value) => handleUpdate({ radius: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.radius ?? 0.5) * 100) / 100}
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
          label={'\u58c1\u539a'}
          max={Math.max(0.1, (node.radius ?? 0.5) - 0.01)}
          min={0}
          onChange={(value) => handleUpdate({ wallThickness: value <= 0.001 ? undefined : value })}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round((node.wallThickness ?? 0) * 1000) / 1000}
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
