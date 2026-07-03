'use client'

import { type AnyNode, type LatheNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  NodeMaterialSection,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { L, S } from '../i18n/panel-labels'
import { TransformPanelSection } from '../shared/transform-panel-section'

export default function LathePanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as LatheNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<LatheNode>) => {
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

  if (!(node && node.type === 'lathe' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper onClose={handleClose} title={node.name || '\u65cb\u8f6c\u4f53'} width={300}>
      <PanelSection title={S.dimensions()}>
        <SliderControl
          label={S.segments()}
          max={128}
          min={8}
          onChange={(value) => handleUpdate({ segments: Math.round(value) })}
          precision={0}
          step={1}
          value={node.segments ?? 32}
        />
        <SliderControl
          label={'\u5f27\u5ea6'}
          max={360}
          min={1}
          onChange={(degrees) => handleUpdate({ arc: (degrees * Math.PI) / 180 })}
          precision={0}
          step={1}
          unit="°"
          value={Math.round(((node.arc ?? Math.PI * 2) * 180) / Math.PI)}
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
