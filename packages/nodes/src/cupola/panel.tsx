'use client'

import {
  type AnyNode,
  type AnyNodeId,
  CupolaNode as CupolaSchema,
  getActiveRoofHeight,
  type RoofSegmentNode,
  useLiveNodeOverrides,
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
import type { CupolaNode } from './schema'

/**
 * Inspector panel for a placed cupola. Roof style + finial + dimensions
 * plus Move / Duplicate / Delete wired into the same ghost-preview drag
 * flow the placement tool uses. Mirrors the box-vent panel.
 */
export default function CupolaPanel() {
  const t = useTranslations()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as CupolaNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<CupolaNode> | undefined) : undefined,
  )
  const node: CupolaNode | undefined =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as CupolaNode) : storeNode

  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const previewProp = useCallback(
    (updates: Partial<CupolaNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )

  const commitProp = useCallback(
    (updates: Partial<CupolaNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleUpdate = commitProp

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
    const cloned = CupolaSchema.parse(cloneInput) as CupolaNode

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

  if (!(node && node.type === 'cupola' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || t('nodes.cupola.cupola')}
      width={300}
    >
      <PanelSection title={t('common.style')}>
        <SegmentedControl
          onChange={(v) => handleUpdate({ roofStyle: v as CupolaNode['roofStyle'] })}
          options={[
            { label: t('nodes.cupola.dome'), value: 'dome' },
            { label: t('nodes.cupola.pyramid'), value: 'pyramid' },
          ]}
          value={node.roofStyle ?? 'dome'}
        />
        <SegmentedControl
          onChange={(v) => handleUpdate({ finial: v === 'on' })}
          options={[
            { label: t('nodes.cupola.finial'), value: 'on' },
            { label: t('nodes.cupola.noFinial'), value: 'off' },
          ]}
          value={(node.finial ?? true) ? 'on' : 'off'}
        />
      </PanelSection>

      <PanelSection title={t('common.dimensions')}>
        <SliderControl
          label={t('common.width')}
          max={1000}
          min={0.3}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label={t('common.depth')}
          max={1000}
          min={0.3}
          onChange={(v) => previewProp({ depth: v })}
          onCommit={(v) => handleUpdate({ depth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.depth * 100) / 100}
        />
        <SliderControl
          label={t('common.height')}
          max={1000}
          min={0.4}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => handleUpdate({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      <PanelSection title={t('common.position')}>
        <SliderControl
          label={t('common.x')}
          max={Math.round(((segment?.width ?? 10) / 2) * 100) / 100}
          min={-Math.round(((segment?.width ?? 10) / 2) * 100) / 100}
          onChange={(v) =>
            previewProp({ position: [v, node.position[1] ?? 0, node.position[2] ?? 0] })
          }
          onCommit={(v) =>
            handleUpdate({ position: [v, node.position[1] ?? 0, node.position[2] ?? 0] })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.position[0] ?? 0) * 100) / 100}
        />
        <SliderControl
          label={t('common.y')}
          max={Math.max(
            (segment?.wallHeight ?? 3) + (segment ? getActiveRoofHeight(segment) : 3) + 2,
            (node.position[1] ?? 0) + 0.1,
          )}
          min={Math.min(0, (node.position[1] ?? 0) - 0.5)}
          onChange={(v) =>
            previewProp({ position: [node.position[0] ?? 0, v, node.position[2] ?? 0] })
          }
          onCommit={(v) =>
            handleUpdate({ position: [node.position[0] ?? 0, v, node.position[2] ?? 0] })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.position[1] ?? 0) * 100) / 100}
        />
        <SliderControl
          label={t('common.z')}
          max={Math.round(((segment?.depth ?? 10) / 2) * 100) / 100}
          min={-Math.round(((segment?.depth ?? 10) / 2) * 100) / 100}
          onChange={(v) =>
            previewProp({ position: [node.position[0] ?? 0, node.position[1] ?? 0, v] })
          }
          onCommit={(v) =>
            handleUpdate({ position: [node.position[0] ?? 0, node.position[1] ?? 0, v] })
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
          onChange={(deg) => previewProp({ rotation: (deg * Math.PI) / 180 })}
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
