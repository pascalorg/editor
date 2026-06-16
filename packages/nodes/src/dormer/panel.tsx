'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DormerNode,
  type RoofNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  cn,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useState } from 'react'
import { DormerActionsSection } from './panel-actions-section'
import { DormerPositionSection } from './panel-position-section'
import { DormerWindowSection } from './panel-window-section'

type RoofType = DormerNode['roofType']
type DormerSection = 'dormer' | 'window'

const ROOF_TYPE_OPTIONS: Array<{ label: string; value: RoofType }> = [
  { label: 'Gable', value: 'gable' },
  { label: 'Hip', value: 'hip' },
  { label: 'Shed', value: 'shed' },
  { label: 'Gambrel', value: 'gambrel' },
  { label: 'Dutch', value: 'dutch' },
  { label: 'Mansard', value: 'mansard' },
  { label: 'Flat', value: 'flat' },
]

const SECTION_OPTIONS: Array<{ label: string; value: DormerSection }> = [
  { label: 'Dormer', value: 'dormer' },
  { label: 'Window', value: 'window' },
]

export default function DormerPanel() {
  const [section, setSection] = useState<DormerSection>('dormer')
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DormerNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<DormerNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as DormerNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  // Slider drag → write live override; release → commit.
  const previewProp = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      if (updates.roofSegmentId !== undefined) {
        const state = useScene.getState()
        const prev = node?.roofSegmentId
        if (prev) state.dirtyNodes.add(prev as AnyNodeId)
        state.dirtyNodes.add(updates.roofSegmentId as AnyNodeId)
        state.dirtyNodes.add(selectedId as AnyNodeId)
      }
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [node, selectedId, updateNode],
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
    if (!(node && selectedId)) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, selectedId, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node?.roofSegmentId) return
    triggerSFX('sfx:item-pick')
    // Deep clone and strip the id so the move tool's onClick branch
    // (`isNew || !node.id`) takes the "create fresh" path. Setting
    // `metadata.isNew = true` is what gates the move tool from
    // updating any existing node — the dormer is only added to the
    // scene on click, not when the Duplicate button is pressed.
    const cloned = structuredClone(node) as DormerNode & { id?: AnyNodeId }
    delete (cloned as { id?: AnyNodeId }).id
    const prevMeta =
      cloned.metadata && typeof cloned.metadata === 'object' && !Array.isArray(cloned.metadata)
        ? (cloned.metadata as Record<string, unknown>)
        : {}
    cloned.metadata = { ...prevMeta, isNew: true }
    setMovingNode(cloned as DormerNode)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const segmentId = node.roofSegmentId
    if (segmentId) {
      const state = useScene.getState()
      const segment = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
      if (segment) {
        state.updateNode(segmentId as AnyNode['id'], {
          children: (segment.children ?? []).filter((id) => id !== selectedId),
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

  if (!(node && node.type === 'dormer' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Dormer'}
      width={300}
    >
      <DormerPositionSection
        commitProp={commitProp}
        node={node}
        previewProp={previewProp}
        roof={roof}
        segment={segment}
        selectedId={selectedId}
      />

      <PanelSection title="Section">
        <div className="grid grid-cols-3 gap-1.5 px-1 pt-1">
          {SECTION_OPTIONS.map((option) => {
            const isSelected = section === option.value
            return (
              <button
                className={cn(
                  'flex min-h-10 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={option.value}
                onClick={() => setSection(option.value)}
                type="button"
              >
                <span className="truncate font-medium">{option.label}</span>
              </button>
            )
          })}
        </div>
      </PanelSection>

      {section === 'dormer' && (
        <>
          <PanelSection title="Dimensions">
            <SliderControl
              label="Width"
              max={4}
              min={0.5}
              onChange={(v) => previewProp({ width: v })}
              onCommit={(v) => commitProp({ width: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.width * 100) / 100}
            />
            <SliderControl
              label="Depth"
              max={5}
              min={0.5}
              onChange={(v) => previewProp({ depth: v })}
              onCommit={(v) => commitProp({ depth: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.depth * 100) / 100}
            />
            <SliderControl
              label="Wall Height"
              max={5}
              min={0}
              onChange={(v) => previewProp({ height: v })}
              onCommit={(v) => commitProp({ height: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.height * 100) / 100}
            />
            <SliderControl
              label="Roof Height"
              max={3}
              min={0}
              onChange={(v) => previewProp({ roofHeight: v })}
              onCommit={(v) => commitProp({ roofHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.roofHeight * 100) / 100}
            />
          </PanelSection>

          <PanelSection title="Roof Type">
            <div className="grid grid-cols-3 gap-1.5 px-1 pt-1">
              {ROOF_TYPE_OPTIONS.map((option) => {
                const isSelected = node.roofType === option.value
                return (
                  <button
                    className={cn(
                      'flex min-h-10 items-center justify-center rounded-lg border px-2 py-2 text-xs transition-colors',
                      isSelected
                        ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                        : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                    )}
                    key={option.value}
                    onClick={() => handleUpdate({ roofType: option.value })}
                    type="button"
                  >
                    <span className="truncate font-medium">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </PanelSection>
        </>
      )}

      {section === 'window' && (
        <DormerWindowSection
          commitProp={commitProp}
          handleUpdate={handleUpdate}
          node={node}
          previewProp={previewProp}
        />
      )}

      <DormerActionsSection
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onMove={handleMove}
      />
    </PanelWrapper>
  )
}
