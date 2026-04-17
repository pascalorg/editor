'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type LevelNode,
  type MaterialSchema,
  type StairNode,
  type StairRailingMode,
  type StairSlabOpeningMode,
  type StairTopLandingMode,
  type StairType,
  StairNode as StairNodeSchema,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE } from '../../tools/stair/stair-defaults'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MaterialPicker } from '../controls/material-picker'
import { MetricControl } from '../controls/metric-control'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { PanelWrapper } from './panel-wrapper'

const RAILING_MODE_OPTIONS: { label: string; value: StairRailingMode }[] = [
  { label: 'None', value: 'none' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
  { label: 'Both', value: 'both' },
]

const STAIR_TYPE_OPTIONS: { label: string; value: StairType }[] = [
  { label: 'Straight', value: 'straight' },
  { label: 'Curved', value: 'curved' },
  { label: 'Spiral', value: 'spiral' },
]

const TOP_LANDING_MODE_OPTIONS: { label: string; value: StairTopLandingMode }[] = [
  { label: 'None', value: 'none' },
  { label: 'Integrated', value: 'integrated' },
]

const STAIR_SLAB_OPENING_OPTIONS: { label: string; value: StairSlabOpeningMode }[] = [
  { label: 'None', value: 'none' },
  { label: 'Destination', value: 'destination' },
]

export function StairPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const createNodes = useScene((s) => s.createNodes)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as StairNode | undefined) : undefined,
  )
  const levels = useScene(
    useShallow((s) =>
      Object.values(s.nodes)
        .filter((entry): entry is LevelNode => entry.type === 'level')
        .sort((left, right) => left.level - right.level),
    ),
  )
  const segments = useScene(
    useShallow((s) => {
      if (!selectedId) return []
      const stairNode = s.nodes[selectedId as AnyNode['id']] as StairNode | undefined
      if (stairNode?.type !== 'stair') return []
      return (stairNode.children ?? [])
        .map((childId) => s.nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
        .filter((entry): entry is StairSegmentNode => entry?.type === 'stair-segment')
    }),
  )

  const handleUpdate = useCallback(
    (updates: Partial<StairNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleMaterialChange = useCallback(
    (material: MaterialSchema) => {
      handleUpdate({ material, materialPreset: undefined })
    },
    [handleUpdate],
  )

  const handleMaterialPresetChange = useCallback(
    (materialPreset: string) => {
      handleUpdate({ materialPreset, material: undefined })
    },
    [handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const getLastSegmentFillDefaults = useCallback(() => {
    if (!node) return { fillToFloor: true }
    const children = node.children ?? []
    const lastChildId = children[children.length - 1]
    if (lastChildId) {
      const lastChild = useScene.getState().nodes[lastChildId as AnyNodeId] as
        | StairSegmentNode
        | undefined
      if (lastChild?.type === 'stair-segment') {
        return { fillToFloor: lastChild.fillToFloor }
      }
    }
    return { fillToFloor: true }
  }, [node])

  const handleAddFlight = useCallback(() => {
    if (!node) return
    const { fillToFloor } = getLastSegmentFillDefaults()
    const segment = StairSegmentNodeSchema.parse({
      segmentType: 'stair',
      width: 1.0,
      length: 3.0,
      height: 2.5,
      stepCount: 10,
      attachmentSide: 'front',
      fillToFloor,
      thickness: 0.25,
      position: [0, 0, 0],
    })
    createNode(segment, node.id as AnyNodeId)
  }, [node, createNode, getLastSegmentFillDefaults])

  const handleAddLanding = useCallback(() => {
    if (!node) return
    const { fillToFloor } = getLastSegmentFillDefaults()
    const segment = StairSegmentNodeSchema.parse({
      segmentType: 'landing',
      width: 1.0,
      length: 1.0,
      height: 0,
      stepCount: 0,
      attachmentSide: 'front',
      fillToFloor,
      thickness: 0.32,
      position: [0, 0, 0],
    })
    createNode(segment, node.id as AnyNodeId)
  }, [node, createNode, getLastSegmentFillDefaults])

  const handleSelectSegment = useCallback(
    (segmentId: string) => {
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    },
    [setSelection],
  )

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    sfxEmitter.emit('sfx:item-pick')

    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata }
    duplicateInfo.children = []
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1,
    ]

    try {
      const duplicate = StairNodeSchema.parse(duplicateInfo)

      const nodesState = useScene.getState().nodes
      const children = node.children || []
      const createOps: { node: AnyNode; parentId?: AnyNodeId }[] = [
        { node: duplicate, parentId: duplicate.parentId as AnyNodeId },
      ]

      for (const childId of children) {
        const childNode = nodesState[childId]
        if (childNode && childNode.type === 'stair-segment') {
          let childDuplicateInfo = structuredClone(childNode) as any
          delete childDuplicateInfo.id
          childDuplicateInfo.metadata = { ...childDuplicateInfo.metadata }
          const childDuplicate = StairSegmentNodeSchema.parse(childDuplicateInfo)
          createOps.push({ node: childDuplicate, parentId: duplicate.id as AnyNodeId })
        }
      }

      createNodes(createOps)

      setSelection({ selectedIds: [duplicate.id as AnyNode['id']] })
    } catch (e) {
      console.error('Failed to duplicate stair', e)
    }
  }, [createNodes, node, setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'stair' && selectedId && selectedCount === 1)) return null

  const resolvedFromLevelId = node.fromLevelId ?? node.parentId ?? levels[0]?.id ?? null
  const resolvedToLevelId = node.toLevelId ?? resolvedFromLevelId

  return (
    <PanelWrapper
      icon="/icons/stairs.png"
      onClose={handleClose}
      title={node.name || 'Staircase'}
      width={300}
    >
      <PanelSection title="Type">
        <SegmentedControl
          onChange={(value) =>
            handleUpdate(
              value === 'spiral' && node.stairType !== 'spiral'
                ? {
                    stairType: value,
                    sweepAngle: DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE,
                    position: [node.position[0], 0, node.position[2]],
                  }
                : { stairType: value },
            )
          }
          options={STAIR_TYPE_OPTIONS}
          value={node.stairType ?? 'straight'}
        />
      </PanelSection>

      <PanelSection title="Opening">
        <div className="space-y-3">
          <ToggleControl
            checked={(node.slabOpeningMode ?? 'none') === 'destination'}
            label="Auto Cutout"
            onChange={(checked) =>
              handleUpdate({
                slabOpeningMode: checked ? 'destination' : 'none',
              })
            }
          />

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              From Level
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(event) => handleUpdate({ fromLevelId: event.target.value })}
              value={resolvedFromLevelId ?? ''}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `Level ${level.level + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              To Level
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(event) => handleUpdate({ toLevelId: event.target.value })}
              value={resolvedToLevelId ?? ''}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `Level ${level.level + 1}`}
                </option>
              ))}
            </select>
          </div>

          <SegmentedControl
            onChange={(value) => handleUpdate({ slabOpeningMode: value as StairSlabOpeningMode })}
            options={STAIR_SLAB_OPENING_OPTIONS}
            value={node.slabOpeningMode ?? 'none'}
          />

          {(node.slabOpeningMode ?? 'none') === 'destination' ? (
            <MetricControl
              label="Opening Offset"
              max={0.5}
              min={0}
              onChange={(value) => handleUpdate({ openingOffset: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={Math.round((node.openingOffset ?? 0) * 100) / 100}
            />
          ) : null}
        </div>
      </PanelSection>

      {node.stairType === 'straight' && (
        <PanelSection title="Segments">
          <div className="flex flex-col gap-1">
            {segments.map((seg, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={seg.id}
                onClick={() => handleSelectSegment(seg.id)}
                type="button"
              >
                <span className="truncate">{seg.name || `Segment ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs capitalize">{seg.segmentType}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label="Add flight"
              onClick={handleAddFlight}
            />
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label="Add landing"
              onClick={handleAddLanding}
            />
          </div>
        </PanelSection>
      )}

      {(node.stairType === 'curved' || node.stairType === 'spiral') && (
        <PanelSection title="Geometry">
          <MetricControl
            label="Width"
            max={10}
            min={0.4}
            onChange={(value) => handleUpdate({ width: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.width ?? 1) * 100) / 100}
          />
          <MetricControl
            label="Rise"
            max={10}
            min={0.2}
            onChange={(value) => handleUpdate({ totalRise: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.totalRise ?? 2.5) * 100) / 100}
          />
          <MetricControl
            label="Steps"
            max={32}
            min={2}
            onChange={(value) => handleUpdate({ stepCount: Math.max(2, Math.round(value)) })}
            precision={0}
            step={1}
            unit=""
            value={Math.max(2, Math.round(node.stepCount ?? 10))}
          />
          {node.stairType !== 'spiral' && (
            <ToggleControl
              checked={node.fillToFloor ?? true}
              label="Fit To Floor"
              onChange={(checked) => handleUpdate({ fillToFloor: checked })}
            />
          )}
          {(node.stairType === 'spiral' || !(node.fillToFloor ?? true)) && (
            <MetricControl
              label="Thickness"
              max={1}
              min={0.02}
              onChange={(value) => handleUpdate({ thickness: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={Math.round((node.thickness ?? 0.25) * 100) / 100}
            />
          )}
          <MetricControl
            label="Inner Radius"
            max={10}
            min={node.stairType === 'spiral' ? 0.05 : 0.2}
            onChange={(value) => handleUpdate({ innerRadius: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.innerRadius ?? 0.9) * 100) / 100}
          />
          <SliderControl
            label="Sweep"
            max={node.stairType === 'spiral' ? 720 : 270}
            min={node.stairType === 'spiral' ? -720 : -270}
            onChange={(degrees) => handleUpdate({ sweepAngle: (degrees * Math.PI) / 180 })}
            precision={0}
            step={1}
            unit="°"
            value={Math.round(((node.sweepAngle ?? Math.PI / 2) * 180) / Math.PI)}
          />
          {node.stairType === 'spiral' && (
            <>
              <SegmentedControl
                onChange={(value) => handleUpdate({ topLandingMode: value })}
                options={TOP_LANDING_MODE_OPTIONS}
                value={node.topLandingMode ?? 'none'}
              />
              {(node.topLandingMode ?? 'none') === 'integrated' && (
                <MetricControl
                  label="Top Landing"
                  max={5}
                  min={0.3}
                  onChange={(value) => handleUpdate({ topLandingDepth: value })}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.topLandingDepth ?? 0.9) * 100) / 100}
                />
              )}
              <ToggleControl
                checked={node.showCenterColumn ?? true}
                label="Center Column"
                onChange={(checked) => handleUpdate({ showCenterColumn: checked })}
              />
              <ToggleControl
                checked={node.showStepSupports ?? true}
                label="Step Supports"
                onChange={(checked) => handleUpdate({ showStepSupports: checked })}
              />
            </>
          )}
        </PanelSection>
      )}

      <PanelSection title="Position">
        <SliderControl
          label="X"
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
          label="Y"
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
          label="Z"
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
          label="Rotation"
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
            label="-45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Railing">
        <SegmentedControl
          onChange={(value) => handleUpdate({ railingMode: value })}
          options={RAILING_MODE_OPTIONS}
          value={node.railingMode ?? 'none'}
        />
        {(node.railingMode ?? 'none') !== 'none' && (
          <SliderControl
            label="Height"
            max={1.4}
            min={0.7}
            onChange={(value) => handleUpdate({ railingHeight: value })}
            precision={2}
            step={0.02}
            unit="m"
            value={Math.round((node.railingHeight ?? 0.92) * 100) / 100}
          />
        )}
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
      <PanelSection title="Material">
        <MaterialPicker
          nodeType="stair"
          onChange={handleMaterialChange}
          onSelectMaterialPreset={handleMaterialPresetChange}
          selectedMaterialPreset={node.materialPreset}
          value={node.material}
        />
      </PanelSection>
    </PanelWrapper>
  )
}
