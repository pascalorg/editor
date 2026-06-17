'use client'

import {
  type AnyNode,
  type AnyNodeId,
  EyebrowVentNode as EyebrowVentSchema,
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
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import type { EyebrowVentNode } from './schema'

/**
 * Inspector panel for a placed eyebrow vent. Louvers toggle + dimensions plus
 * Move / Duplicate / Delete wired into the same ghost-preview drag flow the
 * placement tool uses. Mirrors the box-vent / cupola panel.
 */
export default function EyebrowVentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as EyebrowVentNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId
      ? (s.get(selectedId as AnyNodeId) as Partial<EyebrowVentNode> | undefined)
      : undefined,
  )
  const node: EyebrowVentNode | undefined =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as EyebrowVentNode) : storeNode

  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const previewProp = useCallback(
    (updates: Partial<EyebrowVentNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )

  const commitProp = useCallback(
    (updates: Partial<EyebrowVentNode>) => {
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
    const cloned = EyebrowVentSchema.parse(cloneInput) as EyebrowVentNode

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

  if (!(node && node.type === 'eyebrow-vent' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Eyebrow Vent'}
      width={300}
    >
      <PanelSection title="Style">
        <SegmentedControl
          onChange={(v) => handleUpdate({ style: v as EyebrowVentNode['style'] })}
          options={[
            { label: 'Scoop', value: 'scoop' },
            { label: 'Half-round', value: 'half-round' },
            { label: 'Slant-box', value: 'slant-box' },
          ]}
          value={node.style ?? 'scoop'}
        />
        <SliderControl
          label="Louvers"
          max={8}
          min={0}
          onChange={(v) => previewProp({ louverCount: Math.round(v) })}
          onCommit={(v) => handleUpdate({ louverCount: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.louverCount ?? 3}
        />
        {node.style === 'slant-box' ? (
          <SliderControl
            label="Back height"
            max={1}
            min={0.15}
            onChange={(v) => previewProp({ backRatio: v })}
            onCommit={(v) => handleUpdate({ backRatio: v })}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            value={Math.round((node.backRatio ?? 0.5) * 100) / 100}
          />
        ) : null}
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={3}
          min={0.4}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Depth"
          max={1.5}
          min={0.2}
          onChange={(v) => previewProp({ depth: v })}
          onCommit={(v) => handleUpdate({ depth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.depth * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={1}
          min={0.08}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => handleUpdate({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.02}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
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
          label="Y"
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
          label="Z"
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
          label="Rotation"
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

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
