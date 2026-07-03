'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  duplicateRoofSubtree,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { L, N, S, roofTypeLabel } from '../i18n/panel-labels'

export default function RoofPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoofNode | undefined) : undefined,
  )
  // Shallow selector — only re-renders when the segment list content changes.
  const segments = useScene(
    useShallow((s) => {
      if (!node) return []
      return (node.children ?? [])
        .map((childId) => s.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
        .filter((n): n is RoofSegmentNode => n?.type === 'roof-segment')
    }),
  )

  const handleUpdate = useCallback(
    (updates: Partial<RoofNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleAddSegment = useCallback(() => {
    if (!node) return
    const segment = RoofSegmentNodeSchema.parse({
      width: 6,
      depth: 6,
      wallHeight: 0.5,
      roofHeight: 2.5,
      roofType: 'gable',
      position: [2, 0, 2],
    })
    createNode(segment, node.id as AnyNodeId)
  }, [node, createNode])

  const handleSelectSegment = useCallback(
    (segmentId: string) => {
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    },
    [setSelection],
  )

  const handleDuplicate = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')

    try {
      duplicateRoofSubtree(node.id as AnyNodeId, { mode: 'move' })
    } catch (e) {
      console.error('Failed to duplicate roof', e)
    }
  }, [node])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'roof' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onClose={handleClose}
      title={node.name || N.roof()}
      width={300}
    >
      <PanelSection title={S.segments()}>
        <div className="flex flex-col gap-1">
          {segments.map((seg, i) => (
            <button
              className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
              key={seg.id}
              onClick={() => handleSelectSegment(seg.id)}
              type="button"
            >
              <span className="truncate">{seg.name || L.segmentNamed(i + 1)}</span>
              <span className="text-muted-foreground text-xs capitalize">{roofTypeLabel(seg.roofType)}</span>
            </button>
          ))}
        </div>
        <ActionGroup>
          <ActionButton
            icon={<Plus className="h-3.5 w-3.5" />}
            label={L.addSegment()}
            onClick={handleAddSegment}
          />
        </ActionGroup>
      </PanelSection>

      <PanelSection title={S.position()}>
        <SliderControl
          label={L.x()}
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label={L.y()}
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label={L.z()}
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label={L.rotation()}
          max={180}
          min={-180}
          onChange={(degrees) => {
            handleUpdate({ rotation: (degrees * Math.PI) / 180 })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label={L.rotateMinus45()}
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label={L.rotatePlus45()}
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label={L.move()} onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={L.duplicate()}
            onClick={handleDuplicate}
          />
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
