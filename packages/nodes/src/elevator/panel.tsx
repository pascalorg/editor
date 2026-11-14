'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ElevatorNode,
  getLevelDisplayName,
  type LevelNode,
  type MessageDescriptor,
  normalizeElevatorDimensions,
  requestElevatorLevel,
  resolveElevatorDimensions,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection as BasePanelSection,
  duplicateNodeAndPickUp,
  PanelWrapper,
  resolveElevatorSupportY,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Send, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ElevatorInspectorHover, useElevatorInspection } from './inspection'
import {
  ELEVATOR_PRESETS,
  ELEVATOR_SECTION_FIELDS,
  elevatorPresetPatch,
  elevatorSectionReset,
} from './presets'

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

type ElevatorMetricKey =
  | 'width'
  | 'depth'
  | 'shaftWidth'
  | 'shaftDepth'
  | 'shaftWallThickness'
  | 'cabHeight'
  | 'doorWidth'
  | 'doorHeight'
  | 'speed'
  | 'doorDurationMs'
  | 'dwellMs'

type ElevatorAccessField = 'disabledLevelIds' | 'serviceOnlyLevelIds'

const DOOR_STYLE_OPTIONS: Array<{
  label: MessageDescriptor
  value: ElevatorNode['doorStyle']
}> = [
  {
    label: /* i18n */ { id: 'node.elevator.panel.centerOpening', message: 'Center opening' },
    value: 'center-opening',
  },
  {
    label: /* i18n */ { id: 'node.elevator.panel.singleLeft', message: 'Single left' },
    value: 'single-left',
  },
  {
    label: /* i18n */ { id: 'node.elevator.panel.singleRight', message: 'Single right' },
    value: 'single-right',
  },
]

const DOOR_PANEL_STYLE_OPTIONS: Array<{
  label: MessageDescriptor
  value: ElevatorNode['doorPanelStyle']
}> = [
  {
    label: /* i18n */ { id: 'node.elevator.panel.glassFrame', message: 'Glass frame' },
    value: 'glass-frame',
  },
  {
    label: /* i18n */ { id: 'node.elevator.panel.solidPanel', message: 'Solid panel' },
    value: 'solid-panel',
  },
  {
    label: /* i18n */ { id: 'node.elevator.panel.segmentedPanel', message: 'Segmented panel' },
    value: 'segmented-panel',
  },
]

const SHAFT_STYLE_OPTIONS: Array<{
  label: MessageDescriptor
  value: ElevatorNode['shaftStyle']
}> = [
  {
    label: /* i18n */ { id: 'node.elevator.panel.solid', message: 'Solid' },
    value: 'solid',
  },
  {
    label: /* i18n */ { id: 'node.elevator.panel.glass', message: 'Glass' },
    value: 'glass',
  },
]

function roundMeters(value: number) {
  return Math.round(value * 100) / 100
}

function radiansToDegrees(radians: number) {
  return Math.round((radians * 180) / Math.PI)
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

type ElevatorSection =
  | 'Cab'
  | 'Shaft'
  | 'Doors'
  | 'Service'
  | 'Access'
  | 'Destination'
  | 'Motion'
  | 'Actions'
  | 'Position'
  | 'Rotation'

function PanelSection({
  section,
  title,
  children,
  onReset,
}: {
  section: ElevatorSection
  title: string
  children: ReactNode
  onReset: (section: ElevatorSection) => void
}) {
  const i18n = usePascalI18n()
  return (
    <div
      data-elevator-part={
        section === 'Cab'
          ? 'cab'
          : section === 'Doors'
            ? 'doors'
            : section === 'Shaft'
              ? 'shaft'
              : undefined
      }
    >
      <BasePanelSection
        title={title}
        defaultExpanded={!['Position', 'Rotation', 'Actions', 'Motion'].includes(section)}
      >
        {ELEVATOR_SECTION_FIELDS[section] && (
          <button
            type="button"
            className="self-end text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onReset(section)}
          >
            {i18n._({
              id: 'node.elevator.panel.resetSection',
              message: 'Reset {section}',
              values: { section: title.toLowerCase() },
            })}
          </button>
        )}
        {children}
      </BasePanelSection>
    </div>
  )
}

export default function ElevatorPanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const runtime = useInteractive(
    useShallow((s) => {
      const state = selectedId ? s.elevators[selectedId as AnyNodeId] : null
      if (!state) return null
      return {
        currentLevelId: state.currentLevelId,
        requestedStops: state.requestedStops,
        queue: state.queue,
        targetLevelId: state.targetLevelId,
      }
    }),
  )

  const cutaway = useElevatorInspection((state) => state.nodeId === selectedId && state.cutaway)
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

  const previewMetric = useCallback(
    <K extends ElevatorMetricKey>(key: K, value: ElevatorNode[K]) => {
      if (!(selectedId && node)) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, {
        [key]: value,
        ...normalizeElevatorDimensions({ ...node, [key]: value }),
      })
    },
    [selectedId, node],
  )

  const commitMetric = useCallback(
    <K extends ElevatorMetricKey>(key: K, value: ElevatorNode[K]) => {
      if (!(selectedId && node)) return

      const hasChange = !(node && Math.abs(Number(node[key]) - Number(value)) <= 1e-6)
      if (hasChange) {
        updateNode(selectedId as AnyNode['id'], {
          [key]: value,
          ...normalizeElevatorDimensions({ ...node, [key]: value }),
        })
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
    triggerSFX('sfx:item-pick')
    clearLivePreview()
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [clearLivePreview, node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (node) duplicateNodeAndPickUp(node)
  }, [node])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:structure-delete')
    clearLivePreview()
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [clearLivePreview, selectedId, node, setSelection])

  const requestLevel = useCallback(
    (levelId: LevelNode['id']) => {
      if (!node) return
      if ((node.disabledLevelIds ?? []).includes(levelId)) return
      requestElevatorLevel(node.id as AnyNodeId, levelId as AnyNodeId)
    },
    [node],
  )

  const toggleLevelAccess = useCallback(
    (field: ElevatorAccessField, levelId: LevelNode['id']) => {
      if (!node) return
      const disabledIds = new Set(node.disabledLevelIds ?? [])
      const serviceOnlyIds = new Set(node.serviceOnlyLevelIds ?? [])
      const targetSet = field === 'disabledLevelIds' ? disabledIds : serviceOnlyIds

      if (targetSet.has(levelId)) {
        targetSet.delete(levelId)
      } else {
        targetSet.add(levelId)
      }

      if (field === 'disabledLevelIds' && disabledIds.has(levelId)) {
        serviceOnlyIds.delete(levelId)
      }
      if (field === 'serviceOnlyLevelIds' && serviceOnlyIds.has(levelId)) {
        disabledIds.delete(levelId)
      }

      const nextServiceLevels = getServiceLevels(
        levels,
        getResolvedFromLevelId(node, levels),
        getResolvedToLevelId(node, levels, getResolvedFromLevelId(node, levels)),
      )
      const nextDefaultLevelId =
        node.defaultLevelId && !disabledIds.has(node.defaultLevelId)
          ? node.defaultLevelId
          : (nextServiceLevels.find((level) => !disabledIds.has(level.id))?.id ??
            nextServiceLevels[0]?.id ??
            null)

      handleUpdate({
        defaultLevelId: nextDefaultLevelId,
        disabledLevelIds: Array.from(disabledIds),
        serviceOnlyLevelIds: Array.from(serviceOnlyIds),
      })
    },
    [handleUpdate, levels, node],
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

  useEffect(() => {
    const cancel = () => clearLivePreview()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [clearLivePreview])

  if (!(node && node.type === 'elevator' && selectedId && selectedCount === 1)) return null

  const displayNode = liveOverrides ? ({ ...node, ...liveOverrides } as ElevatorNode) : node
  const displayPosition = liveTransform?.position ?? displayNode.position
  const displayRotation = liveTransform?.rotation ?? displayNode.rotation
  const displayRotationDegrees = radiansToDegrees(displayRotation)
  const dimensions = resolveElevatorDimensions(displayNode)
  const fromLevelId = getResolvedFromLevelId(node, levels)
  const toLevelId = getResolvedToLevelId(node, levels, fromLevelId)
  const servedLevels = getServiceLevels(levels, fromLevelId, toLevelId)
  const servedLevelIdSet = new Set<string>(servedLevels.map((level) => level.id))
  const disabledLevelIds = new Set(
    (node.disabledLevelIds ?? []).filter((levelId) => servedLevelIdSet.has(levelId)),
  )
  const serviceOnlyLevelIds = new Set(
    (node.serviceOnlyLevelIds ?? []).filter((levelId) => servedLevelIdSet.has(levelId)),
  )
  const enabledServedLevels = servedLevels.filter((level) => !disabledLevelIds.has(level.id))
  const defaultLevelOptions =
    enabledServedLevels.length > 0
      ? enabledServedLevels
      : servedLevels.length > 0
        ? servedLevels
        : levels
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
  for (const [index, levelId] of (runtime?.requestedStops ?? []).entries()) {
    destinationOrderByLevelId.set(levelId, index + 1)
  }

  const resetSection = (section: ElevatorSection) => {
    clearLivePreview()
    handleUpdate(elevatorSectionReset(node, section))
  }

  return (
    <ElevatorInspectorHover nodeId={node.id}>
      <PanelWrapper
        icon="/icons/elevator.webp"
        onClose={handleClose}
        title={node.name || i18n._({ id: 'node.elevator.panel.elevator', message: 'Elevator' })}
        width={300}
      >
        <BasePanelSection
          title={i18n._({
            id: 'node.elevator.panel.presetsAndInspection',
            message: 'Presets and inspection',
          })}
        >
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(ELEVATOR_PRESETS).map(([id, preset]) => (
              <button
                key={id}
                type="button"
                className="rounded-lg border border-border/50 p-2 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
                onClick={() => {
                  clearLivePreview()
                  handleUpdate(elevatorPresetPatch(node, id as keyof typeof ELEVATOR_PRESETS))
                }}
              >
                <img
                  src={`/icons/elevator-presets/${id}.webp`}
                  alt=""
                  width={256}
                  height={256}
                  className="h-20 w-full object-contain"
                />
                {i18n._(preset.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={cutaway}
            className="rounded-lg border border-border/50 px-3 py-2 text-sm hover:bg-accent"
            onClick={() => useElevatorInspection.setState({ cutaway: !cutaway })}
          >
            {i18n._({ id: 'node.elevator.panel.cutawayShaft', message: 'Cutaway shaft' })}
          </button>
          <p className="text-xs text-muted-foreground">
            {i18n._({
              id: 'node.elevator.panel.hoverOrFocusASectionTo',
              message:
                'Hover or focus a section to highlight its parts. Cutaway affects this inspection only.',
            })}
          </p>
          <p className="text-xs">
            {i18n._({
              id: 'node.elevator.panel.cabInteriorAndDoorOpening',
              message:
                'Clear cab interior: {width} × {depth} × {height} m. Door opening: {doorWidth} × {doorHeight} m.',
              values: {
                width: (dimensions.width - 0.16).toFixed(2),
                depth: (dimensions.depth - 0.08).toFixed(2),
                height: (dimensions.cabHeight - 0.16).toFixed(2),
                doorWidth: dimensions.doorWidth.toFixed(2),
                doorHeight: dimensions.doorHeight.toFixed(2),
              },
            })}
          </p>
          {servedLevels.some((level) => (level.height ?? 2.5) < dimensions.cabHeight + 0.3) && (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
              {i18n._({
                id: 'node.elevator.panel.theCabNeedsMoreHeadroomThan',
                message:
                  'The cab needs more headroom than one or more served floors provide. Check the floor heights.',
              })}
            </p>
          )}
        </BasePanelSection>
        <PanelSection
          onReset={resetSection}
          section="Cab"
          title={i18n._({ id: 'node.elevator.panel.cab', message: 'Cab' })}
        >
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.width', message: 'Width' })}
            min={0.8}
            onChange={(value) => previewMetric('width', value)}
            onCommit={(value) => commitMetric('width', value)}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.width}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.depth', message: 'Depth' })}
            min={0.8}
            onChange={(value) => previewMetric('depth', value)}
            onCommit={(value) => commitMetric('depth', value)}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.depth}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.cabHeight', message: 'Cab Height' })}
            min={1.8}
            onChange={(value) => previewMetric('cabHeight', value)}
            onCommit={(value) => commitMetric('cabHeight', value)}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.cabHeight}
          />
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Shaft"
          title={i18n._({ id: 'node.elevator.panel.shaft', message: 'Shaft' })}
        >
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {i18n._({ id: 'node.elevator.panel.shaftStyle', message: 'Shaft Style' })}
            </div>
            <select
              aria-label={i18n._({ id: 'node.elevator.panel.shaftStyle2', message: 'Shaft style' })}
              className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(event) =>
                handleUpdate({ shaftStyle: event.target.value as ElevatorNode['shaftStyle'] })
              }
              value={displayNode.shaftStyle ?? 'solid'}
            >
              {SHAFT_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
          </div>
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.shaftWidth', message: 'Shaft Width' })}
            min={dimensions.width}
            onChange={(value) => previewMetric('shaftWidth', Math.max(value, dimensions.width))}
            onCommit={(value) => commitMetric('shaftWidth', Math.max(value, dimensions.width))}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.shaftWidth}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.shaftDepth', message: 'Shaft Depth' })}
            min={dimensions.depth}
            onChange={(value) => previewMetric('shaftDepth', Math.max(value, dimensions.depth))}
            onCommit={(value) => commitMetric('shaftDepth', Math.max(value, dimensions.depth))}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.shaftDepth}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.wallThickness', message: 'Wall Thickness' })}
            min={0.04}
            onChange={(value) => previewMetric('shaftWallThickness', value)}
            onCommit={(value) => commitMetric('shaftWallThickness', value)}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.01}
            unit="m"
            value={dimensions.shaftWallThickness}
          />
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Doors"
          title={i18n._({ id: 'node.elevator.panel.doors', message: 'Doors' })}
        >
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {i18n._({ id: 'node.elevator.panel.openingStyle', message: 'Opening Style' })}
            </div>
            <select
              aria-label={i18n._({
                id: 'node.elevator.panel.doorOpeningStyle',
                message: 'Door opening style',
              })}
              className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(event) =>
                handleUpdate({ doorStyle: event.target.value as ElevatorNode['doorStyle'] })
              }
              value={displayNode.doorStyle ?? 'center-opening'}
            >
              {DOOR_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {i18n._({ id: 'node.elevator.panel.doorType', message: 'Door Type' })}
            </div>
            <select
              aria-label={i18n._({
                id: 'node.elevator.panel.doorPanelStyle',
                message: 'Door panel style',
              })}
              className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(event) =>
                handleUpdate({
                  doorPanelStyle: event.target.value as ElevatorNode['doorPanelStyle'],
                })
              }
              value={displayNode.doorPanelStyle ?? 'glass-frame'}
            >
              {DOOR_PANEL_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </option>
              ))}
            </select>
          </div>
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.doorWidth', message: 'Door Width' })}
            max={dimensions.width - 0.18}
            min={0.45}
            onChange={(value) => previewMetric('doorWidth', value)}
            onCommit={(value) => commitMetric('doorWidth', value)}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.doorWidth}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.doorHeight', message: 'Door Height' })}
            max={dimensions.cabHeight - 0.1}
            min={1.2}
            onChange={(value) => previewMetric('doorHeight', value)}
            onCommit={(value) => commitMetric('doorHeight', value)}
            precision={2}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={dimensions.doorHeight}
          />
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Service"
          title={i18n._({ id: 'node.elevator.panel.service', message: 'Service' })}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {i18n._({ id: 'node.elevator.panel.from', message: 'From' })}
              </div>
              <select
                aria-label={i18n._({ id: 'node.elevator.panel.fromLevel', message: 'From level' })}
                className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-2 text-sm text-foreground"
                onChange={(event) => handleServiceBoundaryChange('fromLevelId', event.target.value)}
                value={fromLevelId}
              >
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {getLevelDisplayName(level)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {i18n._({ id: 'node.elevator.panel.to', message: 'To' })}
              </div>
              <select
                aria-label={i18n._({ id: 'node.elevator.panel.toLevel', message: 'To level' })}
                className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-2 text-sm text-foreground"
                onChange={(event) => handleServiceBoundaryChange('toLevelId', event.target.value)}
                value={toLevelId}
              >
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {getLevelDisplayName(level)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {i18n._({ id: 'node.elevator.panel.defaultFloor', message: 'Default Floor' })}
            </div>
            <select
              aria-label={i18n._({
                id: 'node.elevator.panel.defaultFloor2',
                message: 'Default floor',
              })}
              className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(event) => handleUpdate({ defaultLevelId: event.target.value || null })}
              value={selectedDefaultLevelId}
            >
              {defaultLevelOptions.map((level) => (
                <option key={level.id} value={level.id}>
                  {getLevelDisplayName(level)}
                </option>
              ))}
            </select>
          </div>
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Access"
          title={i18n._({ id: 'node.elevator.panel.access', message: 'Access' })}
        >
          <div className="space-y-2">
            {servedLevels.map((level) => {
              const isDisabled = disabledLevelIds.has(level.id)
              const isServiceOnly = serviceOnlyLevelIds.has(level.id)

              return (
                <div
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/45 bg-black/4 dark:bg-[#2C2C2E] px-2.5 py-2"
                  key={level.id}
                >
                  <span className="min-w-0 truncate text-sm">{getLevelDisplayName(level)}</span>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        isServiceOnly
                          ? 'border-sky-600/40 bg-sky-400/15 text-sky-800 dark:border-sky-300/45 dark:text-sky-100'
                          : 'border-border/50 bg-black/4 dark:bg-black/15 text-muted-foreground hover:text-foreground'
                      } ${isDisabled ? 'cursor-not-allowed opacity-45' : ''}`}
                      disabled={isDisabled}
                      aria-pressed={isServiceOnly}
                      aria-label={i18n._({
                        id: 'node.elevator.panel.serviceOnlyAccessForLevel',
                        message: 'Service-only access for {level}',
                        values: { level: getLevelDisplayName(level) },
                      })}
                      onClick={() => toggleLevelAccess('serviceOnlyLevelIds', level.id)}
                      type="button"
                    >
                      {i18n._({ id: 'node.elevator.panel.service', message: 'Service' })}
                    </button>
                    <button
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        isDisabled
                          ? 'border-red-600/40 bg-red-400/15 text-red-700 dark:border-red-300/45 dark:text-red-100'
                          : 'border-border/50 bg-black/4 dark:bg-black/15 text-muted-foreground hover:text-foreground'
                      }`}
                      aria-pressed={isDisabled}
                      aria-label={i18n._({
                        id: 'node.elevator.panel.disableLevel',
                        message: 'Disable {level}',
                        values: { level: getLevelDisplayName(level) },
                      })}
                      onClick={() => toggleLevelAccess('disabledLevelIds', level.id)}
                      type="button"
                    >
                      {i18n._({ id: 'node.elevator.panel.disabled', message: 'Disabled' })}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Destination"
          title={i18n._({ id: 'node.elevator.panel.destination', message: 'Destination' })}
        >
          <div className="grid grid-cols-2 gap-1.5">
            {servedLevels.map((level) => {
              const isActive = activeLevelId === level.id
              const stopOrder = destinationOrderByLevelId.get(level.id)
              const isDisabled = disabledLevelIds.has(level.id)
              const isServiceOnly = serviceOnlyLevelIds.has(level.id)
              return (
                <button
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-2.5 text-left transition-colors ${
                    isDisabled
                      ? 'cursor-not-allowed border-border/35 bg-black/3 dark:bg-[#202024] text-muted-foreground/55'
                      : isActive
                        ? 'border-emerald-600/45 bg-emerald-400/15 text-emerald-800 dark:border-emerald-400/45 dark:text-emerald-100'
                        : 'border-border/50 bg-black/4 dark:bg-[#2C2C2E] text-foreground hover:bg-black/8 dark:hover:bg-[#3e3e3e]'
                  }`}
                  disabled={isDisabled}
                  key={level.id}
                  onClick={() => requestLevel(level.id)}
                  type="button"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs">{getLevelDisplayName(level)}</span>
                    {isDisabled ? (
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-current/65">
                        {i18n._({ id: 'node.elevator.panel.disabled', message: 'Disabled' })}
                      </span>
                    ) : isServiceOnly ? (
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-current/65">
                        {i18n._({ id: 'node.elevator.panel.service', message: 'Service' })}
                      </span>
                    ) : (
                      stopOrder && (
                        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-current/65">
                          {i18n._({
                            id: 'node.elevator.panel.stopStoporder',
                            message: 'Stop {stopOrder}',
                            values: { stopOrder },
                          })}
                        </span>
                      )
                    )}
                  </span>
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full border border-black/15 dark:border-white/15 bg-black/5 dark:bg-black/20 ${
                      stopOrder ? 'px-1.5 font-mono text-[11px] font-semibold' : ''
                    }`}
                  >
                    {isDisabled ? '×' : (stopOrder ?? <Send className="h-3 w-3" />)}
                  </span>
                </button>
              )
            })}
          </div>
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Motion"
          title={i18n._({ id: 'node.elevator.panel.motion', message: 'Motion' })}
        >
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.speed', message: 'Speed' })}
            max={8}
            min={0.5}
            onChange={(value) => previewMetric('speed', value)}
            onCommit={(value) => commitMetric('speed', value)}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            precision={1}
            step={0.1}
            unit="m/s"
            value={node.speed}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.doorTime', message: 'Door Time' })}
            max={2200}
            min={300}
            onChange={(value) => previewMetric('doorDurationMs', value)}
            onCommit={(value) => commitMetric('doorDurationMs', value)}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={50}
            unit="ms"
            value={node.doorDurationMs}
          />
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.dwell', message: 'Dwell' })}
            max={5000}
            min={300}
            onChange={(value) => previewMetric('dwellMs', value)}
            onCommit={(value) => commitMetric('dwellMs', value)}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={100}
            unit="ms"
            value={node.dwellMs}
          />
        </PanelSection>
        <PanelSection
          onReset={resetSection}
          section="Actions"
          title={i18n._({ id: 'node.elevator.panel.actions', message: 'Actions' })}
        >
          <ActionGroup>
            <ActionButton
              icon={<Move className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.elevator.panel.move', message: 'Move' })}
              onClick={handleMove}
            />
            <ActionButton
              icon={<Copy className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.elevator.panel.duplicate', message: 'Duplicate' })}
              onClick={handleDuplicate}
            />
            <ActionButton
              className="text-destructive hover:text-destructive"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.elevator.panel.delete', message: 'Delete' })}
              onClick={handleDelete}
            />
          </ActionGroup>
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Position"
          title={i18n._({ id: 'node.elevator.panel.position', message: 'Position' })}
        >
          <SliderControl
            label="X"
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
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={roundMeters(displayPosition[0])}
          />
          <SliderControl
            label="Y"
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
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={roundMeters(displayPosition[1])}
          />
          <SliderControl
            label="Z"
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
            onCancel={clearLivePreview}
            step={0.05}
            unit="m"
            value={roundMeters(displayPosition[2])}
          />
        </PanelSection>

        <PanelSection
          onReset={resetSection}
          section="Rotation"
          title={i18n._({ id: 'node.elevator.panel.rotation', message: 'Rotation' })}
        >
          <SliderControl
            label={i18n._({ id: 'node.elevator.panel.yaw', message: 'Yaw' })}
            max={180}
            min={-180}
            onChange={(degrees) => previewTransform(displayPosition, degreesToRadians(degrees))}
            onCommit={(degrees) => commitTransform(displayPosition, degreesToRadians(degrees))}
            precision={0}
            restoreOnCommit={false}
            onCancel={clearLivePreview}
            step={1}
            unit="°"
            value={displayRotationDegrees}
          />
          <div className="flex gap-1.5 px-1 pt-2 pb-1">
            <ActionButton
              label="-45°"
              onClick={() => {
                triggerSFX('sfx:item-rotate')
                commitTransform(displayPosition, displayRotation - Math.PI / 4)
              }}
            />
            <ActionButton
              label="+45°"
              onClick={() => {
                triggerSFX('sfx:item-rotate')
                commitTransform(displayPosition, displayRotation + Math.PI / 4)
              }}
            />
          </div>
        </PanelSection>
      </PanelWrapper>
    </ElevatorInspectorHover>
  )
}
