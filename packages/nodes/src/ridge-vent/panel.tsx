'use client'

import {
  type AnyNode,
  type AnyNodeId,
  RidgeVentNode as RidgeVentSchema,
  type RoofSegmentNode,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
  useEditor,
  useTranslations,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import type { RidgeVentNode } from './schema'

/**
 * Inspector panel for a placed ridge vent. Same structure as box-vent's
 * panel — sliders for style / dimensions / position + Move / Duplicate /
 * Delete actions that route through the kind-owned ghost-drag flow.
 */
export default function RidgeVentPanel() {
  const t = useTranslations()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RidgeVentNode | undefined) : undefined,
  )

  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<RidgeVentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.roofSegmentId) {
      setSelection({ selectedIds: [node.roofSegmentId as AnyNode['id']] })
    }
  }, [node?.roofSegmentId, setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    // Type-union escape — see box-vent panel.
    setMovingNode(node as never)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    const parentId = node.roofSegmentId as AnyNodeId | undefined
    if (!parentId) return

    const state = useScene.getState()
    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const cloneInput = {
      ...node,
      id: undefined,
      metadata: { ...meta, isNew: true },
    } as Record<string, unknown>
    const cloned = RidgeVentSchema.parse(cloneInput) as RidgeVentNode

    state.createNode(cloned, parentId)
    state.dirtyNodes.add(parentId)
    setMovingNode(cloned as never)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const segmentId = node.roofSegmentId
    if (segmentId) {
      const state = useScene.getState()
      const seg = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
      if (seg) {
        state.updateNode(segmentId as AnyNode['id'], {
          children: (seg.children ?? []).filter((id) => id !== selectedId),
        })
      }
    }
    deleteNode(selectedId as AnyNodeId)
    if (segmentId) {
      useScene.getState().dirtyNodes.add(segmentId as AnyNodeId)
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, deleteNode, setSelection])

  if (!(node && node.type === 'ridge-vent' && selectedId)) return null

  // Ridge runs along segment-X axis, so the length slider's max ties to
  // segment.width and the across-ridge X-position to the same span. Z
  // is the across-slope position — for ridge vents this should stay
  // near zero (the ridge line), so clamp it to a narrow window around
  // the segment's center.
  const halfW = Math.round(((segment?.width ?? 10) / 2) * 100) / 100
  const halfD = Math.round(((segment?.depth ?? 10) / 2) * 100) / 100

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || t('nodes.ridgeVent.fallbackTitle')}
      width={300}
    >
      <PanelSection title={t('nodes.ridgeVent.style')}>
        <SegmentedControl
          onChange={(v) => handleUpdate({ style: v as RidgeVentNode['style'] })}
          options={[
            { label: t('nodes.ridgeVent.standard'), value: 'standard' },
            { label: t('nodes.ridgeVent.shingled'), value: 'shingled' },
            { label: t('nodes.ridgeVent.flanged'), value: 'metal' },
          ]}
          value={node.style ?? 'standard'}
        />
        <SegmentedControl
          onChange={(v) => handleUpdate({ endCaps: v === 'yes' })}
          options={[
            { label: t('nodes.ridgeVent.endCaps'), value: 'yes' },
            { label: t('nodes.ridgeVent.open'), value: 'no' },
          ]}
          value={(node.endCaps ?? true) ? 'yes' : 'no'}
        />
      </PanelSection>

      <PanelSection title={t('nodes.ridgeVent.dimensions')}>
        <SliderControl
          label={t('common.length')}
          max={1000}
          min={0.5}
          onChange={(v) => handleUpdate({ length: v })}
          onCommit={(v) => handleUpdate({ length: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.length * 100) / 100}
        />
        <SliderControl
          label={t('common.width')}
          max={0.6}
          min={0.1}
          onChange={(v) => handleUpdate({ width: v })}
          onCommit={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label={t('common.height')}
          max={0.2}
          min={0.03}
          onChange={(v) => handleUpdate({ height: v })}
          onCommit={(v) => handleUpdate({ height: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.height * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title={t('common.position')}>
        <SliderControl
          label={t('common.x')}
          max={halfW}
          min={-halfW}
          onChange={(v) =>
            handleUpdate({
              position: [v, node.position[1] ?? 0, node.position[2] ?? 0],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [v, node.position[1] ?? 0, node.position[2] ?? 0],
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.position[0] ?? 0) * 100) / 100}
        />
        <SliderControl
          label={t('common.y')}
          onChange={(v) =>
            handleUpdate({
              position: [node.position[0] ?? 0, v, node.position[2] ?? 0],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [node.position[0] ?? 0, v, node.position[2] ?? 0],
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.position[1] ?? 0) * 100) / 100}
        />
        <SliderControl
          label={t('common.z')}
          max={halfD}
          min={-halfD}
          onChange={(v) =>
            handleUpdate({
              position: [node.position[0] ?? 0, node.position[1] ?? 0, v],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [node.position[0] ?? 0, node.position[1] ?? 0, v],
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.position[2] ?? 0) * 100) / 100}
        />
        <SliderControl
          label={t('common.rotation')}
          max={180}
          min={-180}
          onChange={(deg) => handleUpdate({ rotation: (deg * Math.PI) / 180 })}
          onCommit={(deg) => handleUpdate({ rotation: (deg * Math.PI) / 180 })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round(((node.rotation ?? 0) * 180) / Math.PI)}
        />
      </PanelSection>

      <PanelSection title={t('common.actions')}>
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label={t('common.move')} onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={t('common.duplicate')}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={t('common.delete')}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
