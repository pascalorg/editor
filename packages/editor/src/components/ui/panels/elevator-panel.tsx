'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ElevatorNode,
  ElevatorNode as ElevatorNodeSchema,
  type LevelNode,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resolveElevatorNodeSupportY, resolveElevatorSupportY } from '../../../lib/elevator-support'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MetricControl } from '../controls/metric-control'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

function findLevelId(levels: LevelNode[], levelId: string | null | undefined) {
  if (!levelId) return null
  return levels.some((level) => level.id === levelId) ? levelId : null
}

function getLegacyServedLevels(node: ElevatorNode | undefined, levels: LevelNode[]) {
  if (!node || node.fromLevelId || node.toLevelId || !node.servedLevelIds?.length) return []
  const servedIds = new Set(node.servedLevelIds)
  return levels.filter((level) => servedIds.has(level.id))
}

function getResolvedFromLevelId(node: ElevatorNode | undefined, levels: LevelNode[]) {
  if (!node) return levels[0]?.id ?? ''
  const legacyServedLevels = getLegacyServedLevels(node, levels)
  return (
    findLevelId(levels, node.fromLevelId) ??
    legacyServedLevels[0]?.id ??
    findLevelId(levels, node.defaultLevelId) ??
    levels[0]?.id ??
    ''
  )
}

function getResolvedToLevelId(
  node: ElevatorNode | undefined,
  levels: LevelNode[],
  fromLevelId: string,
) {
  if (!node) return levels[0]?.id ?? ''

  const explicitTo = findLevelId(levels, node.toLevelId)
  if (explicitTo) return explicitTo
  const legacyServedLevels = getLegacyServedLevels(node, levels)
  const legacyTo = legacyServedLevels[legacyServedLevels.length - 1]?.id
  if (legacyTo) return legacyTo

  const fromIndex = levels.findIndex((level) => level.id === fromLevelId)
  const fallbackIndex = fromIndex >= 0 ? Math.min(fromIndex + 1, levels.length - 1) : 0
  return levels[fallbackIndex]?.id ?? fromLevelId
}

function getServiceLevels(levels: LevelNode[], fromLevelId: string, toLevelId: string) {
  const fromIndex = levels.findIndex((level) => level.id === fromLevelId)
  const toIndex = levels.findIndex((level) => level.id === toLevelId)
  if (fromIndex < 0 && toIndex < 0) return []

  const resolvedFromIndex = fromIndex >= 0 ? fromIndex : toIndex
  const resolvedToIndex =
    toIndex >= 0 ? toIndex : Math.min(Math.max(resolvedFromIndex, 0) + 1, levels.length - 1)
  const minIndex = Math.min(resolvedFromIndex, resolvedToIndex)
  const maxIndex = Math.max(resolvedFromIndex, resolvedToIndex)

  return levels.slice(minIndex, maxIndex + 1)
}

function stripDuplicateFlags(metadata: ElevatorNode['metadata']) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return metadata
  }

  const nextMeta = { ...(metadata as Record<string, unknown>) }
  delete nextMeta.isNew
  delete nextMeta.isTransient
  return nextMeta as ElevatorNode['metadata']
}

type ElevatorMetricKey = 'width' | 'depth' | 'cabHeight' | 'doorWidth' | 'doorHeight'

function roundMeters(value: number) {
  return Math.round(value * 100) / 100
}

function radiansToDegrees(radians: number) {
  return Math.round((radians * 180) / Math.PI)
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

export function ElevatorPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const runtime = useInteractive(
    useShallow((s) => {
      const state = selectedId ? s.elevators[selectedId as AnyNodeId] : null
      if (!state) return null
      return {
        currentLevelId: state.currentLevelId,
        queue: state.queue,
        targetLevelId: state.targetLevelId,
      }
    }),
  )

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ElevatorNode | undefined) : undefined,
  )
  const liveOverrides = useLiveNodeOverrides((s) =>
    selectedId ? s.get(selectedId as AnyNodeId) : undefined,
  )
  const liveTransform = useLiveTransforms((s) =>
    selectedId ? s.get(selectedId as AnyNodeId) : undefined,
  )

  useEffect(() => {
    return () => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
      useLiveTransforms.getState().clear(selectedId as AnyNodeId)
    }
  }, [selectedId])

  const levels = useScene(
    useShallow((s) => {
      if (!(node?.parentId && s.nodes[node.parentId as AnyNodeId]?.type === 'building')) return []
      const building = s.nodes[node.parentId as AnyNodeId]
      if (building?.type !== 'building') return []
      return building.children
        .map((childId) => s.nodes[childId as AnyNodeId])
        .filter((entry): entry is LevelNode => entry?.type === 'level')
        .sort((left, right) => left.level - right.level)
    }),
  )

  const handleUpdate = useCallback(
    (updates: Partial<ElevatorNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const clearLivePreview = useCallback(() => {
    if (!selectedId) return
    useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    useLiveTransforms.getState().clear(selectedId as AnyNodeId)
  }, [selectedId])

  useEffect(() => {
    if (!(selectedId && node?.type === 'elevator')) return
    const supportY = resolveElevatorNodeSupportY(node)
    if (node.position[1] >= supportY - 1e-4) return

    updateNode(selectedId as AnyNode['id'], {
      position: [node.position[0], supportY, node.position[2]],
    })
  }, [
    node?.defaultLevelId,
    node?.fromLevelId,
    node?.id,
    node?.parentId,
    node?.position[0],
    node?.position[1],
    node?.position[2],
    node?.type,
    selectedId,
    updateNode,
  ])

  const previewMetric = useCallback(
    <K extends ElevatorMetricKey>(key: K, value: ElevatorNode[K]) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, { [key]: value })
    },
    [selectedId],
  )

  const commitMetric = useCallback(
    <K extends ElevatorMetricKey>(key: K, value: ElevatorNode[K]) => {
      if (!selectedId) return

      const hasChange = !(node && Math.abs(Number(node[key]) - Number(value)) <= 1e-6)
      if (hasChange) {
        updateNode(selectedId as AnyNode['id'], { [key]: value } as Partial<ElevatorNode>)
      }
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [node, selectedId, updateNode],
  )

  const previewTransform = useCallback(
    (position: ElevatorNode['position'], rotation: ElevatorNode['rotation']) => {
      if (!selectedId) return
      useLiveTransforms.getState().set(selectedId as AnyNodeId, { position, rotation })
    },
    [selectedId],
  )

  const commitTransform = useCallback(
    (position: ElevatorNode['position'], rotation: ElevatorNode['rotation']) => {
      if (!(selectedId && node)) return
      useLiveTransforms.getState().clear(selectedId as AnyNodeId)
      const positionChanged = node.position.some(
        (value, index) => Math.abs(value - position[index]!) > 1e-6,
      )
      const rotationChanged = Math.abs(node.rotation - rotation) > 1e-6
      if (positionChanged || rotationChanged) {
        updateNode(selectedId as AnyNode['id'], { position, rotation })
      }
    },
    [node, selectedId, updateNode],
  )

  const getSupportedPosition = useCallback(
    (x: number, z: number): ElevatorNode['position'] => {
      if (!node) return [x, 0, z]
      const supportY = resolveElevatorSupportY({
        buildingId: node.parentId,
        preferredLevelId: node.fromLevelId ?? node.defaultLevelId,
        x,
        z,
      })
      return [x, supportY, z]
    },
    [node],
  )

  const handleClose = useCallback(() => {
    clearLivePreview()
    setSelection({ selectedIds: [] })
  }, [clearLivePreview, setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    clearLivePreview()
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [clearLivePreview, node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!(node && node.parentId)) return
    sfxEmitter.emit('sfx:item-pick')

    const duplicate = ElevatorNodeSchema.parse({
      ...structuredClone(node),
      id: undefined,
      name: node.name ? `${node.name} Copy` : 'Elevator Copy',
      position: [node.position[0] + 1, node.position[1], node.position[2] + 1],
      metadata: { ...(stripDuplicateFlags(node.metadata) as Record<string, unknown>), isNew: true },
    })

    createNode(duplicate, node.parentId as AnyNodeId)
    clearLivePreview()
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [clearLivePreview, node, createNode, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:structure-delete')
    clearLivePreview()
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [clearLivePreview, selectedId, node, setSelection])

  const requestLevel = useCallback(
    (levelId: LevelNode['id']) => {
      if (!node) return
      useInteractive.getState().requestElevator(node.id as AnyNodeId, levelId as AnyNodeId)
    },
    [node],
  )

  const handleServiceBoundaryChange = useCallback(
    (field: 'fromLevelId' | 'toLevelId', levelId: string) => {
      if (!node) return
      const nextFromLevelId =
        field === 'fromLevelId' ? levelId : getResolvedFromLevelId(node, levels)
      const nextToLevelId =
        field === 'toLevelId' ? levelId : getResolvedToLevelId(node, levels, nextFromLevelId)
      const nextServedLevels = getServiceLevels(levels, nextFromLevelId, nextToLevelId)
      const currentDefaultIsServed = nextServedLevels.some(
        (level) => level.id === node.defaultLevelId,
      )

      handleUpdate({
        [field]: levelId || null,
        defaultLevelId: currentDefaultIsServed
          ? node.defaultLevelId
          : nextFromLevelId || nextServedLevels[0]?.id || null,
        ...(field === 'fromLevelId'
          ? {
              position: [
                node.position[0],
                resolveElevatorSupportY({
                  buildingId: node.parentId,
                  preferredLevelId: nextFromLevelId,
                  x: node.position[0],
                  z: node.position[2],
                }),
                node.position[2],
              ] as ElevatorNode['position'],
            }
          : {}),
        servedLevelIds: undefined,
      } as Partial<ElevatorNode>)
    },
    [node, levels, handleUpdate],
  )

  if (!(node && node.type === 'elevator' && selectedId && selectedCount === 1)) return null

  const displayNode = liveOverrides ? ({ ...node, ...liveOverrides } as ElevatorNode) : node
  const displayPosition = liveTransform?.position ?? displayNode.position
  const displayRotation = liveTransform?.rotation ?? displayNode.rotation
  const displayRotationDegrees = radiansToDegrees(displayRotation)
  const fromLevelId = getResolvedFromLevelId(node, levels)
  const toLevelId = getResolvedToLevelId(node, levels, fromLevelId)
  const servedLevels = getServiceLevels(levels, fromLevelId, toLevelId)
  const defaultLevelOptions = servedLevels.length > 0 ? servedLevels : levels
  const selectedDefaultLevelId = defaultLevelOptions.some(
    (level) => level.id === node.defaultLevelId,
  )
    ? (node.defaultLevelId ?? '')
    : fromLevelId
  const activeLevelId =
    runtime?.currentLevelId ??
    (servedLevels.some((level) => level.id === node.defaultLevelId)
      ? node.defaultLevelId
      : fromLevelId || levels[0]?.id) ??
    null
  const destinationOrderByLevelId = new Map<string, number>()
  const orderedDestinationIds: string[] = []
  if (runtime?.targetLevelId) orderedDestinationIds.push(runtime.targetLevelId)
  for (const levelId of runtime?.queue ?? []) {
    if (!orderedDestinationIds.includes(levelId)) orderedDestinationIds.push(levelId)
  }
  orderedDestinationIds.forEach((levelId, index) => {
    destinationOrderByLevelId.set(levelId, index + 1)
  })

  return (
    <PanelWrapper
      icon="/icons/elevator.svg"
      onClose={handleClose}
      title={node.name || 'Elevator'}
      width={300}
    >
      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="text-destructive hover:text-destructive"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={50}
          min={-50}
          onChange={(value) => {
            const position = getSupportedPosition(value, displayPosition[2])
            previewTransform(position, displayRotation)
          }}
          onCommit={(value) => {
            const position = getSupportedPosition(value, displayPosition[2])
            commitTransform(position, displayRotation)
          }}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={roundMeters(displayPosition[0])}
        />
        <SliderControl
          label="Y"
          max={50}
          min={-50}
          onChange={(value) => {
            const position: ElevatorNode['position'] = [
              displayPosition[0],
              value,
              displayPosition[2],
            ]
            previewTransform(position, displayRotation)
          }}
          onCommit={(value) => {
            const position: ElevatorNode['position'] = [
              displayPosition[0],
              value,
              displayPosition[2],
            ]
            commitTransform(position, displayRotation)
          }}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={roundMeters(displayPosition[1])}
        />
        <SliderControl
          label="Z"
          max={50}
          min={-50}
          onChange={(value) => {
            const position = getSupportedPosition(displayPosition[0], value)
            previewTransform(position, displayRotation)
          }}
          onCommit={(value) => {
            const position = getSupportedPosition(displayPosition[0], value)
            commitTransform(position, displayRotation)
          }}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={roundMeters(displayPosition[2])}
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label="Yaw"
          max={180}
          min={-180}
          onChange={(degrees) => previewTransform(displayPosition, degreesToRadians(degrees))}
          onCommit={(degrees) => commitTransform(displayPosition, degreesToRadians(degrees))}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={displayRotationDegrees}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              commitTransform(displayPosition, displayRotation - Math.PI / 4)
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              commitTransform(displayPosition, displayRotation + Math.PI / 4)
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Cab">
        <MetricControl
          label="Width"
          max={4}
          min={0.8}
          onChange={(value) => previewMetric('width', value)}
          onCommit={(value) => commitMetric('width', value)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={displayNode.width}
        />
        <MetricControl
          label="Depth"
          max={4}
          min={0.8}
          onChange={(value) => previewMetric('depth', value)}
          onCommit={(value) => commitMetric('depth', value)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={displayNode.depth}
        />
        <MetricControl
          label="Cab Height"
          max={4}
          min={1.8}
          onChange={(value) => previewMetric('cabHeight', value)}
          onCommit={(value) => commitMetric('cabHeight', value)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={displayNode.cabHeight}
        />
      </PanelSection>

      <PanelSection title="Doors">
        <MetricControl
          label="Door Width"
          max={Math.max(displayNode.width - 0.1, 0.5)}
          min={0.45}
          onChange={(value) => previewMetric('doorWidth', value)}
          onCommit={(value) => commitMetric('doorWidth', value)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={displayNode.doorWidth}
        />
        <MetricControl
          label="Door Height"
          max={Math.max(displayNode.cabHeight - 0.1, 1.3)}
          min={1.2}
          onChange={(value) => previewMetric('doorHeight', value)}
          onCommit={(value) => commitMetric('doorHeight', value)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={displayNode.doorHeight}
        />
      </PanelSection>

      <PanelSection title="Service">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              From
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-sm text-foreground"
              onChange={(event) =>
                handleServiceBoundaryChange('fromLevelId', event.target.value)
              }
              value={fromLevelId}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `Level ${level.level}`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              To
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-sm text-foreground"
              onChange={(event) => handleServiceBoundaryChange('toLevelId', event.target.value)}
              value={toLevelId}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name || `Level ${level.level}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Default Floor
          </div>
          <select
            className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
            onChange={(event) => handleUpdate({ defaultLevelId: event.target.value || null })}
            value={selectedDefaultLevelId}
          >
            {defaultLevelOptions.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name || `Level ${level.level}`}
              </option>
            ))}
          </select>
        </div>
      </PanelSection>

      <PanelSection title="Destination">
        <div className="grid grid-cols-2 gap-1.5">
          {servedLevels.map((level) => {
            const isActive = activeLevelId === level.id
            const stopOrder = destinationOrderByLevelId.get(level.id)
            return (
              <button
                className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-2.5 text-left transition-colors ${
                  isActive
                    ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-100'
                    : 'border-border/50 bg-[#2C2C2E] text-foreground hover:bg-[#3e3e3e]'
                }`}
                key={level.id}
                onClick={() => requestLevel(level.id)}
                type="button"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs">{level.name || `Level ${level.level}`}</span>
                  {stopOrder && (
                    <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-current/65">
                      Stop {stopOrder}
                    </span>
                  )}
                </span>
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full border border-white/15 bg-black/20 ${
                    stopOrder ? 'px-1.5 font-mono text-[11px] font-semibold' : ''
                  }`}
                >
                  {stopOrder ?? <Send className="h-3 w-3" />}
                </span>
              </button>
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title="Motion">
        <SliderControl
          label="Speed"
          max={8}
          min={0.5}
          onChange={(value) => handleUpdate({ speed: value })}
          precision={1}
          step={0.1}
          unit="m/s"
          value={node.speed}
        />
        <SliderControl
          label="Door Time"
          max={2200}
          min={300}
          onChange={(value) => handleUpdate({ doorDurationMs: value })}
          step={50}
          unit="ms"
          value={node.doorDurationMs}
        />
        <SliderControl
          label="Dwell"
          max={5000}
          min={300}
          onChange={(value) => handleUpdate({ dwellMs: value })}
          step={100}
          unit="ms"
          value={node.dwellMs}
        />
      </PanelSection>
    </PanelWrapper>
  )
}
