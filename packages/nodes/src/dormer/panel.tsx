'use client'

import {
  type AnyNode,
  type AnyNodeId,
  createDormerDefaultWindow,
  type DormerNode,
  generateId,
  type RoofNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import {
  cn,
  createFreshPlacementSubtree,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
  useTranslations,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { DormerActionsSection } from './panel-actions-section'
import { DormerPositionSection } from './panel-position-section'
import { DormerWindowsSection } from './panel-windows-section'
import { planDormerWindowRow } from './window-layout'

type RoofType = DormerNode['roofType']
type ShedHighSide = DormerNode['shedHighSide']
type DormerSection = 'dormer' | 'window'

const ROOF_TYPE_OPTIONS: Array<{ labelKey: string; value: RoofType }> = [
  { labelKey: 'nodes.dormer.gable', value: 'gable' },
  { labelKey: 'nodes.dormer.hip', value: 'hip' },
  { labelKey: 'nodes.dormer.shed', value: 'shed' },
  { labelKey: 'nodes.dormer.gambrel', value: 'gambrel' },
  { labelKey: 'nodes.dormer.dutch', value: 'dutch' },
  { labelKey: 'nodes.dormer.mansard', value: 'mansard' },
  { labelKey: 'nodes.dormer.flat', value: 'flat' },
]

const SHED_HIGH_SIDE_OPTIONS: Array<{ label: string; value: ShedHighSide }> = [
  { label: 'Rise Back', value: 'back' },
  { label: 'Rise Front', value: 'front' },
]

const SECTION_OPTIONS: Array<{ labelKey: string; value: DormerSection }> = [
  { labelKey: 'nodes.dormer.dormer', value: 'dormer' },
  { labelKey: 'nodes.dormer.window', value: 'window' },
]

export default function DormerPanel() {
  const t = useTranslations()
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
  const hostedWindows = useScene(
    useShallow((state) => {
      if (!selectedId) return []
      const dormer = state.nodes[selectedId as AnyNodeId]
      if (dormer?.type !== 'dormer') return []
      return (dormer.children ?? [])
        .map((childId) => state.nodes[childId as AnyNodeId])
        .filter((child): child is WindowNode => child?.type === 'window')
    }),
  )

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
    useScene.temporal.getState().pause()
    const draftId = createFreshPlacementSubtree(node.id as AnyNodeId)
    const draft = draftId ? (useScene.getState().nodes[draftId] as DormerNode | undefined) : null
    if (!draft) {
      useScene.temporal.getState().resume()
      return
    }
    setMovingNode(draft)
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

  const handleAddWindow = useCallback(() => {
    if (!node) return
    const frontWindows = hostedWindows.filter(
      (window) => (window.dormerFace ?? 'front') === 'front',
    )
    const template = frontWindows[0] ?? hostedWindows[0]
    const id = generateId('window')
    const defaultWindow = createDormerDefaultWindow(node, id)
    const newWindow = WindowNode.parse({
      ...(template ? structuredClone(template) : defaultWindow),
      id,
      name: `Window ${hostedWindows.length + 1}`,
      parentId: node.id,
      dormerId: node.id,
      dormerFace: 'front',
      wallId: undefined,
      roofSegmentId: undefined,
      roofFace: undefined,
      position: [0, template?.position[1] ?? defaultWindow.position[1], 0],
      rotation: [0, 0, 0],
      side: 'front',
      metadata: {},
      visible: true,
    })
    const plan = planDormerWindowRow(node.width, [...frontWindows, newWindow])
    if (!plan) return

    const newPlacement = plan.find((entry) => entry.id === newWindow.id)
    if (!newPlacement) return
    const placedWindow = WindowNode.parse({
      ...newWindow,
      position: newPlacement.position,
      width: newPlacement.width,
    })
    const existingIds = new Set<string>(frontWindows.map((window) => window.id))
    useScene.getState().applyNodeChanges({
      create: [{ node: placedWindow, parentId: node.id as AnyNodeId }],
      update: plan
        .filter((entry) => existingIds.has(entry.id))
        .map((entry) => ({
          id: entry.id as AnyNodeId,
          data: { position: entry.position, width: entry.width },
        })),
    })
    triggerSFX('sfx:structure-build')
  }, [hostedWindows, node])

  const handleEditWindow = useCallback(
    (window: WindowNode) => {
      setSelection({ selectedIds: [window.id] })
    },
    [setSelection],
  )

  const handleMoveWindow = useCallback(
    (window: WindowNode) => {
      triggerSFX('sfx:item-pick')
      setMovingNode(window)
      setSelection({ selectedIds: [] })
    },
    [setMovingNode, setSelection],
  )

  if (!(node && node.type === 'dormer' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined
  const frontWindows = hostedWindows.filter((window) => (window.dormerFace ?? 'front') === 'front')
  const templateWindow = frontWindows[0] ?? hostedWindows[0]
  const defaultWindow = createDormerDefaultWindow(node, 'window_preview')
  const canAddWindow =
    planDormerWindowRow(node.width, [
      ...frontWindows,
      {
        id: 'window_preview',
        position: [0, templateWindow?.position[1] ?? defaultWindow.position[1], 0],
        width: templateWindow?.width ?? defaultWindow.width,
      },
    ]) !== null

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || t('nodes.dormer.dormer')}
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

      <PanelSection title={t('nodes.dormer.section')}>
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
                <span className="truncate font-medium">{t(option.labelKey)}</span>
              </button>
            )
          })}
        </div>
      </PanelSection>

      {section === 'dormer' && (
        <>
          <PanelSection title={t('common.dimensions')}>
            <SliderControl
              label={t('nodes.dormer.width')}
              max={1000}
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
              label={t('nodes.dormer.depth')}
              max={1000}
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
              label={t('nodes.dormer.wallHeight')}
              max={1000}
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
              label={node.roofType === 'shed' ? 'Pitch Rise' : t('nodes.dormer.roofHeight')}
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
                    <span className="truncate font-medium">{t(option.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </PanelSection>

          {node.roofType === 'shed' && (
            <PanelSection title="Pitch Direction">
              <div className="grid grid-cols-2 gap-1.5 px-1 pt-1">
                {SHED_HIGH_SIDE_OPTIONS.map((option) => {
                  const isSelected = node.shedHighSide === option.value
                  return (
                    <button
                      className={cn(
                        'flex min-h-10 items-center justify-center rounded-lg border px-2 py-2 text-xs transition-colors',
                        isSelected
                          ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                          : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                      )}
                      key={option.value}
                      onClick={() => handleUpdate({ shedHighSide: option.value })}
                      type="button"
                    >
                      <span className="truncate font-medium">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            </PanelSection>
          )}
        </>
      )}

      {section === 'window' && (
        <DormerWindowsSection
          canAdd={canAddWindow}
          onAdd={handleAddWindow}
          onEdit={handleEditWindow}
          onMove={handleMoveWindow}
          windows={hostedWindows}
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
