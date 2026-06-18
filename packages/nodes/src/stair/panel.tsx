'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type LadderNode,
  LadderNode as LadderNodeSchema,
  type LevelNode,
  type StairNode,
  StairNode as StairNodeSchema,
  type StairRailingMode,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  type StairSlabOpeningMode,
  type StairTopLandingMode,
  type StairType,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE,
  duplicateStairSubtree,
  getStairLevelOptions,
  MetricControl,
  PanelSection,
  PanelWrapper,
  resolveStairDestinationLevel,
  resolveStairFromLevelId,
  resolveStairToLevelId,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

const RAILING_MODE_OPTIONS: { label: string; value: StairRailingMode }[] = [
  { label: '无', value: 'none' },
  { label: '左侧', value: 'left' },
  { label: '右侧', value: 'right' },
  { label: '两侧', value: 'both' },
]

const STAIR_TYPE_OPTIONS: { label: string; value: StairType }[] = [
  { label: '直跑', value: 'straight' },
  { label: '弧形', value: 'curved' },
  { label: '螺旋', value: 'spiral' },
]

type StairPanelType = StairType | 'ladder'

const STAIR_PANEL_TYPE_OPTIONS: { label: string; value: StairPanelType }[] = [
  ...STAIR_TYPE_OPTIONS,
  { label: '\u722c\u68af', value: 'ladder' },
]

const TOP_LANDING_MODE_OPTIONS: { label: string; value: StairTopLandingMode }[] = [
  { label: '无', value: 'none' },
  { label: '一体式', value: 'integrated' },
]

const STAIR_SLAB_OPENING_OPTIONS: { label: string; value: StairSlabOpeningMode }[] = [
  { label: '无', value: 'none' },
  { label: '目标楼层', value: 'destination' },
]

const CENTER_COLUMN_SHAPE_OPTIONS: { label: string; value: StairNode['centerColumnShape'] }[] = [
  { label: '圆柱', value: 'round' },
  { label: '方柱', value: 'square' },
]

function rotationYFromLadder(ladder: LadderNode): number {
  return Array.isArray(ladder.rotation) ? (ladder.rotation[1] ?? 0) : 0
}

function createReplacementLadder(stair: StairNode): LadderNode {
  return LadderNodeSchema.parse({
    name: stair.name,
    parentId: stair.parentId,
    visible: stair.visible,
    metadata: stair.metadata,
    position: stair.position,
    rotation: [0, stair.rotation ?? 0, 0],
    height: stair.totalRise ?? 3,
    width: Math.min(Math.max(stair.width ?? 0.55, 0.25), 1.2),
  })
}

function createReplacementStair(
  ladder: LadderNode,
  stairType: StairType,
  segmentId?: StairSegmentNode['id'],
): StairNode {
  return StairNodeSchema.parse({
    name: ladder.name,
    parentId: ladder.parentId,
    visible: ladder.visible,
    metadata: ladder.metadata,
    position: ladder.position,
    rotation: rotationYFromLadder(ladder),
    stairType,
    fromLevelId: ladder.parentId,
    toLevelId: ladder.parentId,
    width: Math.min(Math.max(ladder.width ?? 1, 0.4), 10),
    totalRise: Math.max(ladder.height ?? 2.5, 0.2),
    stepCount: 10,
    children: segmentId ? [segmentId] : [],
    ...(stairType === 'spiral' ? { sweepAngle: DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE } : {}),
  })
}

function createDefaultPanelStairSegment(fillToFloor = true): StairSegmentNode {
  return StairSegmentNodeSchema.parse({
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
}

export default function StairPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const nodes = useScene((s) => s.nodes)

  const node = useScene((s) =>
    selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as StairNode | LadderNode | undefined)
      : undefined,
  )
  const levels = useMemo<LevelNode[]>(
    () => (node?.type === 'stair' ? getStairLevelOptions(nodes, node) : []),
    [node, nodes],
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
    (updates: Partial<AnyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleAutoCutoutChange = useCallback(
    (checked: boolean) => {
      if (!node || node.type !== 'stair') return
      const updates: Partial<StairNode> = {
        slabOpeningMode: checked ? 'destination' : 'none',
      }
      const sceneNodes = useScene.getState().nodes
      const fromLevelId = resolveStairFromLevelId(sceneNodes, node)
      if (checked && fromLevelId) updates.fromLevelId = fromLevelId
      if (checked && (!node.toLevelId || node.toLevelId === fromLevelId)) {
        const plan = resolveStairDestinationLevel({
          fromLevelId,
          nodes: sceneNodes,
        })
        if (plan?.toLevel.id) updates.toLevelId = plan.toLevel.id
      }
      handleUpdate(updates)
    },
    [node, handleUpdate],
  )

  const handleFromLevelChange = useCallback(
    (fromLevelId: string) => {
      const plan = resolveStairDestinationLevel({
        fromLevelId: fromLevelId as AnyNodeId,
        nodes: useScene.getState().nodes,
      })
      handleUpdate({
        fromLevelId,
        toLevelId: plan?.toLevel.id ?? fromLevelId,
      })
    },
    [handleUpdate],
  )

  const replaceSelection = useCallback(
    (nextNode: StairNode | LadderNode, previousId: AnyNodeId) => {
      useScene.getState().applyNodeChanges({
        create: [
          { node: nextNode, parentId: (nextNode.parentId ?? undefined) as AnyNodeId | undefined },
        ],
        delete: [previousId],
      })
      setSelection({ selectedIds: [nextNode.id as AnyNodeId] })
    },
    [setSelection],
  )

  const handleTypeChange = useCallback(
    (value: StairPanelType) => {
      if (!(node && selectedId)) return

      if (node.type === 'stair') {
        if (value === 'ladder') {
          replaceSelection(createReplacementLadder(node), selectedId as AnyNodeId)
          return
        }

        handleUpdate(
          value === 'spiral' && node.stairType !== 'spiral'
            ? {
                stairType: value,
                sweepAngle: DEFAULT_SPIRAL_STAIR_SWEEP_ANGLE,
                position: [node.position[0], 0, node.position[2]],
              }
            : { stairType: value },
        )
        return
      }

      if (value === 'ladder') return

      const segment = value === 'straight' ? createDefaultPanelStairSegment() : null
      const stair = createReplacementStair(node, value, segment?.id)
      useScene.getState().applyNodeChanges({
        create: [
          { node: stair, parentId: (stair.parentId ?? undefined) as AnyNodeId | undefined },
          ...(segment ? [{ node: segment, parentId: stair.id as AnyNodeId }] : []),
        ],
        delete: [selectedId as AnyNodeId],
      })
      setSelection({ selectedIds: [stair.id as AnyNodeId] })
    },
    [node, selectedId, handleUpdate, replaceSelection, setSelection],
  )

  const getLastSegmentFillDefaults = useCallback(() => {
    if (!node || node.type !== 'stair') return { fillToFloor: true }
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
    if (!node || node.type !== 'stair') return
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
    if (!node || node.type !== 'stair') return
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
    if (!node || node.type !== 'stair') return
    triggerSFX('sfx:item-pick')

    try {
      duplicateStairSubtree(node.id as AnyNodeId, { mode: 'move' })
    } catch (e) {
      console.error('Failed to duplicate stair', e)
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

  if (
    !(
      node &&
      (node.type === 'stair' || node.type === 'ladder') &&
      selectedId &&
      selectedCount === 1
    )
  ) {
    return null
  }

  if (node.type === 'ladder') {
    const ladderRotationY = rotationYFromLadder(node)

    return (
      <PanelWrapper
        icon="/icons/stairs.webp"
        onClose={handleClose}
        title={node.name || '\u722c\u68af'}
        width={300}
      >
        <PanelSection title={'\u7c7b\u578b'}>
          <SegmentedControl
            onChange={handleTypeChange}
            options={STAIR_PANEL_TYPE_OPTIONS}
            value="ladder"
          />
        </PanelSection>

        <PanelSection title={'\u5c3a\u5bf8'}>
          <MetricControl
            label={'\u9ad8\u5ea6'}
            max={20}
            min={0.5}
            onChange={(value) => handleUpdate({ height: value } as Partial<AnyNode>)}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.height ?? 3) * 100) / 100}
          />
          <MetricControl
            label={'\u5bbd\u5ea6'}
            max={1.2}
            min={0.25}
            onChange={(value) => handleUpdate({ width: value } as Partial<AnyNode>)}
            precision={2}
            step={0.01}
            unit="m"
            value={Math.round((node.width ?? 0.55) * 100) / 100}
          />
          <MetricControl
            label={'\u79bb\u5899\u6df1\u5ea6'}
            max={0.8}
            min={0}
            onChange={(value) => handleUpdate({ standoffDepth: value } as Partial<AnyNode>)}
            precision={2}
            step={0.01}
            unit="m"
            value={Math.round((node.standoffDepth ?? 0.16) * 100) / 100}
          />
        </PanelSection>

        <PanelSection title={'\u6a2a\u6863'}>
          <MetricControl
            label={'\u95f4\u8ddd'}
            max={0.6}
            min={0.15}
            onChange={(value) => handleUpdate({ rungSpacing: value } as Partial<AnyNode>)}
            precision={2}
            step={0.01}
            unit="m"
            value={Math.round((node.rungSpacing ?? 0.3) * 100) / 100}
          />
          <MetricControl
            label={'\u6a2a\u6863\u76f4\u5f84'}
            max={0.08}
            min={0.01}
            onChange={(value) => handleUpdate({ rungDiameter: value } as Partial<AnyNode>)}
            precision={3}
            step={0.005}
            unit="m"
            value={Math.round((node.rungDiameter ?? 0.03) * 1000) / 1000}
          />
          <MetricControl
            label={'\u7acb\u6746\u76f4\u5f84'}
            max={0.1}
            min={0.015}
            onChange={(value) => handleUpdate({ railDiameter: value } as Partial<AnyNode>)}
            precision={3}
            step={0.005}
            unit="m"
            value={Math.round((node.railDiameter ?? 0.04) * 1000) / 1000}
          />
        </PanelSection>

        <PanelSection title={'\u5b89\u5168\u7b3c'}>
          <ToggleControl
            checked={node.cageEnabled ?? false}
            label={'\u542f\u7528\u5b89\u5168\u7b3c'}
            onChange={(checked) => handleUpdate({ cageEnabled: checked } as Partial<AnyNode>)}
          />
          {node.cageEnabled ? (
            <>
              <MetricControl
                label={'\u534a\u5f84'}
                max={0.8}
                min={0.25}
                onChange={(value) => handleUpdate({ cageRadius: value } as Partial<AnyNode>)}
                precision={2}
                step={0.01}
                unit="m"
                value={Math.round((node.cageRadius ?? 0.42) * 100) / 100}
              />
              <MetricControl
                label={'\u8d77\u59cb\u9ad8\u5ea6'}
                max={8}
                min={0.5}
                onChange={(value) => handleUpdate({ cageStartHeight: value } as Partial<AnyNode>)}
                precision={2}
                step={0.05}
                unit="m"
                value={Math.round((node.cageStartHeight ?? 1.8) * 100) / 100}
              />
            </>
          ) : null}
        </PanelSection>

        <PanelSection title={'\u5916\u89c2'}>
          <div className="flex items-center justify-between px-1 py-1">
            <span className="text-foreground/80 text-xs">{'\u989c\u8272'}</span>
            <div className="flex items-center gap-2">
              <input
                className="h-7 w-9 cursor-pointer rounded border border-border/50 bg-transparent"
                onChange={(event) =>
                  handleUpdate({ color: event.target.value } as Partial<AnyNode>)
                }
                type="color"
                value={node.color ?? '#8a9098'}
              />
              <input
                className="w-24 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 font-mono text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
                onChange={(event) =>
                  handleUpdate({ color: event.target.value } as Partial<AnyNode>)
                }
                type="text"
                value={node.color ?? '#8a9098'}
              />
            </div>
          </div>
        </PanelSection>

        <PanelSection title={'\u4f4d\u7f6e'}>
          <SliderControl
            label="X"
            max={50}
            min={-50}
            onChange={(v) =>
              handleUpdate({
                position: [v, node.position[1], node.position[2]],
              } as Partial<AnyNode>)
            }
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round(node.position[0] * 100) / 100}
          />
          <SliderControl
            label="Z"
            max={50}
            min={-50}
            onChange={(v) =>
              handleUpdate({
                position: [node.position[0], node.position[1], v],
              } as Partial<AnyNode>)
            }
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round(node.position[2] * 100) / 100}
          />
          <SliderControl
            label={'\u65cb\u8f6c'}
            max={180}
            min={-180}
            onChange={(degrees) =>
              handleUpdate({ rotation: [0, (degrees * Math.PI) / 180, 0] } as Partial<AnyNode>)
            }
            precision={0}
            step={1}
            unit={'\u00b0'}
            value={Math.round((ladderRotationY * 180) / Math.PI)}
          />
        </PanelSection>

        <PanelSection title={'\u64cd\u4f5c'}>
          <ActionGroup>
            <ActionButton
              icon={<Move className="h-3.5 w-3.5" />}
              label={'\u79fb\u52a8'}
              onClick={handleMove}
            />
            <ActionButton
              className="hover:bg-red-500/20"
              icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
              label={'\u5220\u9664'}
              onClick={handleDelete}
            />
          </ActionGroup>
        </PanelSection>
      </PanelWrapper>
    )
  }

  const resolvedFromLevelId = resolveStairFromLevelId(nodes, node, levels)
  const resolvedToLevelId = resolveStairToLevelId(nodes, node, resolvedFromLevelId, levels)

  return (
    <PanelWrapper
      icon="/icons/stairs.webp"
      onClose={handleClose}
      title={node.name || '楼梯'}
      width={300}
    >
      <PanelSection title="类型">
        <SegmentedControl
          onChange={handleTypeChange}
          options={STAIR_PANEL_TYPE_OPTIONS}
          value={node.stairType ?? 'straight'}
        />
      </PanelSection>

      <PanelSection title="开洞">
        <div className="space-y-3">
          <ToggleControl
            checked={(node.slabOpeningMode ?? 'none') === 'destination'}
            label="自动开洞"
            onChange={handleAutoCutoutChange}
          />

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              起始楼层
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-foreground text-sm"
              onChange={(event) => handleFromLevelChange(event.target.value)}
              value={resolvedFromLevelId ?? ''}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `楼层 ${level.level + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              目标楼层
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-foreground text-sm"
              onChange={(event) => handleUpdate({ toLevelId: event.target.value })}
              value={resolvedToLevelId ?? ''}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `楼层 ${level.level + 1}`}
                </option>
              ))}
            </select>
          </div>

          <SegmentedControl
            onChange={(value) => handleAutoCutoutChange(value === 'destination')}
            options={STAIR_SLAB_OPENING_OPTIONS}
            value={node.slabOpeningMode ?? 'none'}
          />

          {(node.slabOpeningMode ?? 'none') === 'destination' ? (
            <MetricControl
              label="开洞偏移"
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
        <PanelSection title="分段">
          <div className="flex flex-col gap-1">
            {segments.map((seg, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={seg.id}
                onClick={() => handleSelectSegment(seg.id)}
                type="button"
              >
                <span className="truncate">{seg.name || `分段 ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs capitalize">
                  {seg.segmentType === 'landing' ? '平台' : '梯段'}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label="添加梯段"
              onClick={handleAddFlight}
            />
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label="添加平台"
              onClick={handleAddLanding}
            />
          </div>
        </PanelSection>
      )}

      {(node.stairType === 'curved' || node.stairType === 'spiral') && (
        <PanelSection title="几何">
          <MetricControl
            label="宽度"
            max={10}
            min={0.4}
            onChange={(value) => handleUpdate({ width: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.width ?? 1) * 100) / 100}
          />
          <MetricControl
            label="升高"
            max={10}
            min={0.2}
            onChange={(value) => handleUpdate({ totalRise: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.totalRise ?? 2.5) * 100) / 100}
          />
          <MetricControl
            label="台阶数"
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
              label="贴合楼层"
              onChange={(checked) => handleUpdate({ fillToFloor: checked })}
            />
          )}
          {(node.stairType === 'spiral' || !(node.fillToFloor ?? true)) && (
            <MetricControl
              label="厚度"
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
            label="内半径"
            max={10}
            min={node.stairType === 'spiral' ? 0.05 : 0.2}
            onChange={(value) => handleUpdate({ innerRadius: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.innerRadius ?? 0.9) * 100) / 100}
          />
          <SliderControl
            label="旋转角"
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
                  label="顶部平台"
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
                label="中心柱"
                onChange={(checked) => handleUpdate({ showCenterColumn: checked })}
              />
              {(node.showCenterColumn ?? true) && (
                <SegmentedControl
                  onChange={(value) => handleUpdate({ centerColumnShape: value })}
                  options={CENTER_COLUMN_SHAPE_OPTIONS}
                  value={node.centerColumnShape ?? 'round'}
                />
              )}
              <ToggleControl
                checked={node.showStepSupports ?? true}
                label="踏步支撑"
                onChange={(checked) => handleUpdate({ showStepSupports: checked })}
              />
            </>
          )}
        </PanelSection>
      )}

      <PanelSection title="位置">
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
          label="旋转"
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
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="栏杆">
        <SegmentedControl
          onChange={(value) => handleUpdate({ railingMode: value })}
          options={RAILING_MODE_OPTIONS}
          value={node.railingMode ?? 'none'}
        />
        {(node.railingMode ?? 'none') !== 'none' && (
          <SliderControl
            label="高度"
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

      <PanelSection title="操作">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="移动" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="复制"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="删除"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
