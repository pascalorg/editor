'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getBoundarySurfaces,
  getLevelDisplayName,
  type LevelNode,
  type MessageDescriptor,
  measureStair,
  planStairPreset,
  planStairRiseEdit,
  planStairSizingEdit,
  proposeStairLayouts,
  resolveStairArcDimensions,
  resolveStairTotalRise,
  runAsSingleSceneHistoryStep,
  type SlabNode,
  type StairLayoutPreset,
  type StairNode,
  type StairRailingMode,
  type StairRailingStyle,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  type StairSlabOpeningMode,
  type StairTopLandingMode,
  type StairType,
  usePascalI18n,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  duplicateNodeAndPickUp,
  formatLinearMeasurement,
  getStairLevelOptions,
  MetricControl,
  PanelSection,
  PanelWrapper,
  resolveStairDestinationLevel,
  resolveStairFromLevelId,
  resolveStairToLevelId,
  SegmentedControl,
  SelectControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { StairConstructionControls } from './construction-controls'
import { getStairDestinationUpdates } from './destination'
import { StairRailingControls } from './railing-controls'
import { getStairTypeChange } from './stair-type'

/** Core's stair diagnostics in the UI language; codes without fixed text show core's message. */
const STAIR_DIAGNOSTIC_MESSAGES: Partial<Record<string, MessageDescriptor>> = {
  'invalid-rise': /* i18n */ {
    id: 'node.stair.diagnostic.invalidRise',
    message: 'The destination must be above the stair base.',
  },
  'landing-overlap': /* i18n */ {
    id: 'node.stair.diagnostic.landingOverlap',
    message:
      'Landing depth exceeds a full circle at the walking line; the visible landing is limited to one circle.',
  },
  'narrow-winder-end': /* i18n */ {
    id: 'node.stair.diagnostic.narrowWinderEnd',
    message: 'The narrow end of a winder tread is below 0.10 m; check the intended stair use.',
  },
  'invalid-flight': /* i18n */ {
    id: 'node.stair.diagnostic.invalidFlight',
    message: 'Flight dimensions and integer riser count must be positive.',
  },
  'riser-target': /* i18n */ {
    id: 'node.stair.diagnostic.riserTarget',
    message: 'Riser height exceeds the design target.',
  },
  'going-target': /* i18n */ {
    id: 'node.stair.diagnostic.goingTarget',
    message: 'Going is below the design target.',
  },
  'comfort-target': /* i18n */ {
    id: 'node.stair.diagnostic.comfortTarget',
    message: 'Two risers plus going is outside the 0.60–0.65 m design range.',
  },
  'nonuniform-risers': /* i18n */ {
    id: 'node.stair.diagnostic.nonuniformRisers',
    message:
      'Flight riser heights differ. Use uniform-riser repair only if this is a proposed design.',
  },
  'raised-landing': /* i18n */ {
    id: 'node.stair.diagnostic.raisedLanding',
    message: 'A landing has a stored rise; inspect its transition before repair.',
  },
  'arrival-mismatch': /* i18n */ {
    id: 'node.stair.diagnostic.arrivalMismatch',
    message: 'The flight chain does not reach the declared destination.',
  },
  'headroom-unresolved': /* i18n */ {
    id: 'node.stair.diagnostic.headroomUnresolved',
    message:
      'Detailed headroom could not be evaluated: check riser counts and the surface query budget.',
  },
  'headroom-target': /* i18n */ {
    id: 'node.stair.diagnostic.headroomTarget',
    message: 'Overhead surfaces leave less than the target headroom.',
  },
}

const RAILING_MODE_OPTIONS: { label: MessageDescriptor; value: StairRailingMode }[] = [
  { label: /* i18n */ { id: 'node.stair.panel.none', message: 'None' }, value: 'none' },
  { label: /* i18n */ { id: 'node.stair.panel.left', message: 'Left' }, value: 'left' },
  { label: /* i18n */ { id: 'node.stair.panel.right', message: 'Right' }, value: 'right' },
  { label: /* i18n */ { id: 'node.stair.panel.both', message: 'Both' }, value: 'both' },
]
const RAILING_STYLE_OPTIONS: { label: MessageDescriptor; value: StairRailingStyle }[] = [
  {
    label: /* i18n */ { id: 'node.stair.panel.balusters', message: 'Balusters' },
    value: 'balusters',
  },
  {
    label: /* i18n */ { id: 'node.stair.panel.postRail', message: 'Post & rail' },
    value: 'post-and-rail',
  },
  { label: /* i18n */ { id: 'node.stair.panel.cable', message: 'Cable' }, value: 'cable' },
  { label: /* i18n */ { id: 'node.stair.panel.boards', message: 'Boards' }, value: 'boards' },
  { label: /* i18n */ { id: 'node.stair.panel.glass', message: 'Glass' }, value: 'glass' },
  { label: /* i18n */ { id: 'node.stair.panel.metal', message: 'Metal' }, value: 'metal' },
]

const STAIR_TYPE_OPTIONS: { label: MessageDescriptor; value: StairType }[] = [
  { label: /* i18n */ { id: 'node.stair.panel.straight', message: 'Straight' }, value: 'straight' },
  { label: /* i18n */ { id: 'node.stair.panel.curved', message: 'Curved' }, value: 'curved' },
  { label: /* i18n */ { id: 'node.stair.panel.spiral', message: 'Spiral' }, value: 'spiral' },
]

const TOP_LANDING_MODE_OPTIONS: { label: MessageDescriptor; value: StairTopLandingMode }[] = [
  { label: /* i18n */ { id: 'node.stair.panel.none', message: 'None' }, value: 'none' },
  {
    label: /* i18n */ { id: 'node.stair.panel.integrated', message: 'Integrated' },
    value: 'integrated',
  },
]

const STAIR_SLAB_OPENING_OPTIONS: { label: MessageDescriptor; value: StairSlabOpeningMode }[] = [
  { label: /* i18n */ { id: 'node.stair.panel.none', message: 'None' }, value: 'none' },
  {
    label: /* i18n */ { id: 'node.stair.panel.destination', message: 'Destination' },
    value: 'destination',
  },
]

// Slabs at least this high off the storey floor read as decks (mezzanines) —
// lower slabs are floor coverings, never useful stair destinations.
const DECK_DESTINATION_MIN_ELEVATION = 0.5

export default function StairPanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const nodes = useScene((s) => s.nodes)
  const [presetTurn, setPresetTurn] = useState<'left' | 'right'>('left')
  const [turningStrategy, setTurningStrategy] = useState<'landing' | 'winder'>('landing')
  const [innerGap, setInnerGap] = useState(0)
  const [walkingLineOffset, setWalkingLineOffset] = useState(0.5)
  const [division, setDivision] = useState<'equal-going' | 'equal-angle'>('equal-going')
  const [riseError, setRiseError] = useState<{ id: string; message: string } | null>(null)
  const installedPlugins = useScene((s) => s.installedPlugins)
  useRegistryVersion()

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as StairNode | undefined) : undefined,
  )
  const levels = useMemo<LevelNode[]>(
    () => (node?.type === 'stair' ? getStairLevelOptions(nodes, node) : []),
    [node, nodes],
  )
  const candidateDecks = useMemo<SlabNode[]>(() => {
    if (node?.type !== 'stair') return []
    const level = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    if (level?.type !== 'level') return []
    const decks: SlabNode[] = []
    for (const childId of level.children) {
      const child = nodes[childId as AnyNodeId]
      if (child?.type !== 'slab') continue
      if (child.id === node.deckSlabId || child.elevation >= DECK_DESTINATION_MIN_ELEVATION) {
        decks.push(child)
      }
    }
    return decks
  }, [node, nodes])
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
      const scene = useScene.getState()
      const current = scene.nodes[selectedId as AnyNodeId]
      if (current?.type === 'stair' && typeof updates.totalRise === 'number') {
        try {
          const changes = planStairRiseEdit(current, updates.totalRise, scene.nodes)
          changes[0]!.data = updates
          scene.updateNodes(changes)
          setRiseError(null)
        } catch (error) {
          if (!(error instanceof RangeError)) throw error
          setRiseError({ id: current.id, message: error.message })
        }
      } else {
        updateNode(selectedId as AnyNode['id'], updates)
      }
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleAutoCutoutChange = useCallback(
    (checked: boolean) => {
      if (!node) return
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

  const handleStairTypeChange = useCallback(
    (value: StairType) => {
      if (!node) return
      const change = getStairTypeChange(node, value, useScene.getState().nodes)
      runAsSingleSceneHistoryStep(useScene, () => {
        updateNode(node.id as AnyNode['id'], change.updates)
        if (change.segment) createNode(change.segment, node.id as AnyNodeId)
      })
    },
    [node, updateNode, createNode],
  )

  const handleDestinationChange = useCallback(
    (value: string) => {
      if (!node) return
      const target = useScene.getState().nodes[value as AnyNodeId]
      handleUpdate(getStairDestinationUpdates(node, target, value))
    },
    [node, handleUpdate],
  )

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
    if (node) duplicateNodeAndPickUp(node)
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

  if (!(node && node.type === 'stair' && selectedId && selectedCount === 1)) return null

  const resolvedFromLevelId = resolveStairFromLevelId(nodes, node, levels)
  const resolvedToLevelId = resolveStairToLevelId(nodes, node, resolvedFromLevelId, levels)
  const deckNode = node.deckSlabId ? nodes[node.deckSlabId as AnyNodeId] : undefined
  const attachedDeck = deckNode?.type === 'slab' ? deckNode : undefined
  const resolvedRise = resolveStairTotalRise(node, nodes)
  const measurements = measureStair(node, nodes)
  const applySizing = (fitRun: boolean) => {
    const scene = useScene.getState()
    const current = scene.nodes[node.id]
    if (current?.type !== 'stair') return
    try {
      scene.updateNodes(planStairSizingEdit(current, scene.nodes, fitRun))
      setRiseError(null)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      setRiseError({ id: current.id, message: error.message })
    }
  }
  const layoutOptions = proposeStairLayouts(node, nodes)
    .filter((option) => option.layout === 'straight' || option.turn === presetTurn)
    .map((option) => {
      try {
        return {
          ...option,
          footprint: planStairPreset(node, nodes, {
            layout: option.layout,
            turn: presetTurn,
            turningStrategy,
            innerGap,
            walkingLineOffset,
            division,
          }).footprint,
        }
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        return { ...option, footprint: null }
      }
    })
  const applyPreset = (layout: StairLayoutPreset) => {
    const scene = useScene.getState()
    const current = scene.nodes[node.id]
    if (current?.type !== 'stair') return
    try {
      const plan = planStairPreset(current, scene.nodes, {
        layout,
        turn: presetTurn,
        turningStrategy,
        innerGap,
        walkingLineOffset,
        division,
      })
      runAsSingleSceneHistoryStep(useScene, () => {
        scene.deleteNodes(plan.removeIds)
        for (const segment of plan.segments) {
          if (scene.nodes[segment.id]) scene.updateNode(segment.id, segment)
          else scene.createNode(segment, current.id)
        }
        scene.updateNode(current.id, plan.stair)
      })
      setRiseError(null)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      setRiseError({ id: current.id, message: error.message })
    }
  }
  const minimumRise = Math.max(
    0.001,
    (node.stairType === 'straight'
      ? segments
          .filter((segment) => segment.segmentType === 'landing')
          .reduce((sum, segment) => sum + segment.height, 0)
      : 0) + 0.001,
  )
  const surfaceLevelId =
    node.destinationSurfaceId && node.parentId === node.destinationSurfaceId
      ? nodes[node.parentId as AnyNodeId]?.parentId
      : node.parentId
  const boundarySurfaces = getBoundarySurfaces(nodes, surfaceLevelId, installedPlugins)
  const connectedSurface = node.destinationSurfaceId
    ? nodes[node.destinationSurfaceId as AnyNodeId]
    : undefined

  return (
    <PanelWrapper
      icon="/icons/stairs.webp"
      onClose={handleClose}
      title={node.name || i18n._({ id: 'node.stair.panel.staircase', message: 'Staircase' })}
      width={300}
    >
      <PanelSection title={i18n._({ id: 'node.stair.panel.type', message: 'Type' })}>
        <SegmentedControl
          onChange={handleStairTypeChange}
          options={STAIR_TYPE_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
          value={node.stairType ?? 'straight'}
        />
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.stair.panel.layout', message: 'Layout' })}>
        <SegmentedControl
          value={presetTurn}
          onChange={setPresetTurn}
          options={[
            {
              label: i18n._({ id: 'node.stair.panel.leftTurn', message: 'Left turn' }),
              value: 'left',
            },
            {
              label: i18n._({ id: 'node.stair.panel.rightTurn', message: 'Right turn' }),
              value: 'right',
            },
          ]}
        />
        <SegmentedControl
          value={turningStrategy}
          onChange={setTurningStrategy}
          options={[
            {
              label: i18n._({ id: 'node.stair.panel.landing', message: 'Landing' }),
              value: 'landing',
            },
            {
              label: i18n._({ id: 'node.stair.panel.winder', message: 'Winder' }),
              value: 'winder',
            },
          ]}
        />
        {turningStrategy === 'winder' && (
          <>
            <MetricControl
              label={i18n._({ id: 'node.stair.panel.innerGap', message: 'Inner gap' })}
              unit="m"
              min={0}
              step={0.05}
              precision={2}
              value={innerGap}
              onChange={setInnerGap}
            />
            <MetricControl
              label={i18n._({
                id: 'node.stair.panel.walkingLineOffset',
                message: 'Walking line offset',
              })}
              unit="m"
              min={0.001}
              step={0.05}
              precision={2}
              value={walkingLineOffset}
              onChange={setWalkingLineOffset}
            />
            <SegmentedControl
              value={division}
              onChange={setDivision}
              options={[
                {
                  label: i18n._({ id: 'node.stair.panel.equalGoing', message: 'Equal going' }),
                  value: 'equal-going',
                },
                {
                  label: i18n._({ id: 'node.stair.panel.equalAngle', message: 'Equal angle' }),
                  value: 'equal-angle',
                },
              ]}
            />
          </>
        )}
        <div className="grid grid-cols-3 gap-2">
          {layoutOptions.map((option) => {
            const label =
              option.layout === 'straight'
                ? i18n._({ id: 'node.stair.layout.straight', message: 'Straight' })
                : i18n._({
                    id: 'node.stair.layout.turn',
                    message: '{layout} turn',
                    values: { layout: option.layout.toUpperCase() },
                  })
            return (
              <button
                key={option.layout}
                type="button"
                aria-label={i18n._({
                  id: 'node.stair.panel.applyLabelLayout',
                  message: 'Apply {label} layout',
                  values: { label },
                })}
                disabled={!option.footprint}
                onClick={() => applyPreset(option.layout)}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-1 py-3 text-foreground transition-colors hover:border-foreground/40 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg aria-hidden="true" width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path
                    d={
                      option.layout === 'straight'
                        ? 'M16 27V5'
                        : option.layout === 'l'
                          ? 'M7 27V7H27'
                          : 'M7 27V7H25V27'
                    }
                    stroke="currentColor"
                    strokeWidth="6"
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    transform={presetTurn === 'right' ? 'translate(32 0) scale(-1 1)' : undefined}
                  />
                </svg>
                <span className="text-xs font-medium">{label}</span>
                <span className="text-center text-[11px] leading-tight text-muted-foreground">
                  {option.footprint
                    ? `${formatLinearMeasurement(option.footprint.width, unit, metricNotation)} × ${formatLinearMeasurement(option.footprint.length, unit, metricNotation)}`
                    : i18n._({ id: 'node.stair.panel.unavailable', message: 'Unavailable' })}
                </span>
              </button>
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.stair.panel.sizing', message: 'Sizing' })}>
        <details className="px-1 text-xs">
          <summary className="cursor-pointer py-2 text-muted-foreground">
            {i18n._({ id: 'node.stair.panel.measurements', message: 'Measurements' })}
          </summary>
          <div className="space-y-2 px-1 text-xs">
            {measurements.flights.map((flight, index) => (
              <div key={flight.nodeId}>
                {i18n._({
                  id: 'node.stair.panel.flightMeasurements',
                  message:
                    'Flight {number}: {count, plural, one {# riser} other {# risers}} · R {riser} · T {going} · {slope}',
                  values: {
                    number: index + 1,
                    count: flight.count,
                    riser:
                      flight.riserHeight === null
                        ? '—'
                        : formatLinearMeasurement(flight.riserHeight, unit, metricNotation),
                    going:
                      flight.going === null
                        ? '—'
                        : formatLinearMeasurement(flight.going, unit, metricNotation),
                    slope:
                      flight.slope === null
                        ? '—'
                        : `${((flight.slope * 180) / Math.PI).toFixed(1)}°`,
                  },
                })}
              </div>
            ))}
            <div>
              {i18n._({ id: 'node.stair.panel.headroom', message: 'Headroom:' })}{' '}
              {measurements.headroom.status === 'unresolved'
                ? i18n._({ id: 'node.stair.panel.notEvaluated', message: 'Not evaluated' })
                : measurements.headroom.minimum === null
                  ? i18n._({
                      id: 'node.stair.panel.noOverheadSurface',
                      message: 'No overhead surface',
                    })
                  : formatLinearMeasurement(measurements.headroom.minimum, unit, metricNotation)}
            </div>
            <div className="text-muted-foreground">
              {i18n._({
                id: 'node.stair.panel.floorsCeilingsAndStairsOnly',
                message: 'Floors, ceilings and stairs only.',
              })}
            </div>
          </div>
        </details>
        {[
          ...new Set(
            measurements.diagnostics.map((diagnostic) => {
              const message = STAIR_DIAGNOSTIC_MESSAGES[diagnostic.code]
              return message ? i18n._(message) : diagnostic.message
            }),
          ),
        ].map((message) => (
          <div
            key={message}
            role="status"
            className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            {message}
          </div>
        ))}
        <details className="space-y-3">
          <summary className="cursor-pointer px-1 py-2 text-xs text-muted-foreground">
            {i18n._({ id: 'node.stair.panel.designTargets', message: 'Design targets' })}
          </summary>
          <MetricControl
            label={i18n._({ id: 'node.stair.panel.targetMaxRiser', message: 'Target max riser' })}
            unit="m"
            precision={3}
            step={0.005}
            min={0.001}
            value={measurements.targets.maxRiserHeight}
            onChange={(value) =>
              handleUpdate({ designTargets: { ...measurements.targets, maxRiserHeight: value } })
            }
          />
          <MetricControl
            label={i18n._({
              id: 'node.stair.panel.targetMinimumGoing',
              message: 'Target minimum going',
            })}
            unit="m"
            precision={3}
            step={0.01}
            min={0.001}
            value={measurements.targets.minimumGoing}
            onChange={(value) =>
              handleUpdate({ designTargets: { ...measurements.targets, minimumGoing: value } })
            }
          />
          <MetricControl
            label={i18n._({ id: 'node.stair.panel.targetGoing', message: 'Target going' })}
            unit="m"
            precision={3}
            step={0.01}
            min={0.001}
            value={measurements.targets.targetGoing}
            onChange={(value) =>
              handleUpdate({ designTargets: { ...measurements.targets, targetGoing: value } })
            }
          />
          <MetricControl
            label={i18n._({ id: 'node.stair.panel.targetHeadroom', message: 'Target headroom' })}
            unit="m"
            precision={2}
            step={0.05}
            min={0.001}
            value={measurements.targets.minimumHeadroom}
            onChange={(value) =>
              handleUpdate({ designTargets: { ...measurements.targets, minimumHeadroom: value } })
            }
          />
        </details>
        <ActionButton
          className="flex-none"
          label={i18n._({ id: 'node.stair.panel.fitUniformRisers', message: 'Fit uniform risers' })}
          onClick={() => applySizing(false)}
        />
        <ActionButton
          className="flex-none"
          label={i18n._({
            id: 'node.stair.panel.fitRisersAndGoing',
            message: 'Fit risers and going',
          })}
          onClick={() => applySizing(true)}
        />
      </PanelSection>
      {node.stairType === 'straight' &&
        (boundarySurfaces.length > 0 || node.destinationSurfaceId) && (
          <PanelSection
            title={i18n._({
              id: 'node.stair.panel.surfaceConnection',
              message: 'Surface connection',
            })}
          >
            <div className="space-y-2">
              <ToggleControl
                checked={node.autoSurfaceSnap !== false}
                label={i18n._({
                  id: 'node.stair.panel.snapToNearbySurfaces',
                  message: 'Snap to nearby surfaces',
                })}
                onChange={(checked) => handleUpdate({ autoSurfaceSnap: checked })}
              />
              <p className="px-1 text-[11px] text-muted-foreground">
                {node.autoSurfaceSnap !== false
                  ? connectedSurface
                    ? connectedSurface.name
                      ? i18n._({
                          id: 'node.stair.panel.connectedTo',
                          message:
                            'Connected to {surface}. Move the stair to connect to another edge.',
                          values: { surface: connectedSurface.name },
                        })
                      : i18n._({
                          id: 'node.stair.panel.connectedToSurface',
                          message:
                            'Connected to a surface. Move the stair to connect to another edge.',
                        })
                    : i18n._({
                        id: 'node.stair.panel.dragNearADeckPatioConcrete',
                        message:
                          'Drag near a deck, patio, concrete slab, or landing edge to fit the stair.',
                      })
                  : i18n._({
                      id: 'node.stair.panel.movingThisStairKeepsItsCurrent',
                      message: 'Moving this stair keeps its current rise, steps, and run.',
                    })}
              </p>
            </div>
          </PanelSection>
        )}

      <PanelSection title={i18n._({ id: 'node.stair.panel.opening', message: 'Opening' })}>
        <div className="space-y-3">
          {attachedDeck ? null : (
            <ToggleControl
              checked={(node.slabOpeningMode ?? 'none') === 'destination'}
              label={i18n._({ id: 'node.stair.panel.autoCutout', message: 'Auto Cutout' })}
              onChange={handleAutoCutoutChange}
            />
          )}

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              {i18n._({ id: 'node.stair.panel.fromLevel', message: 'From Level' })}
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-foreground text-sm"
              onChange={(event) => handleFromLevelChange(event.target.value)}
              value={resolvedFromLevelId ?? ''}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {getLevelDisplayName(level)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              {i18n._({ id: 'node.stair.panel.to', message: 'To' })}
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-foreground text-sm"
              onChange={(event) => handleDestinationChange(event.target.value)}
              value={attachedDeck ? attachedDeck.id : (resolvedToLevelId ?? '')}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {getLevelDisplayName(level)}
                </option>
              ))}
              {candidateDecks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name || i18n._({ id: 'node.stair.panel.deck', message: 'Deck' })}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
              {i18n._({ id: 'node.stair.panel.rise', message: 'Rise' })}
            </div>
            <SegmentedControl
              onChange={(value) =>
                handleUpdate(
                  value === 'custom' ? { totalRise: resolvedRise } : { totalRise: undefined },
                )
              }
              options={[
                {
                  label: attachedDeck
                    ? i18n._({ id: 'node.stair.panel.followsDeck', message: 'Follows deck' })
                    : i18n._({ id: 'node.stair.panel.followsLevel', message: 'Follows level' }),
                  value: 'follows',
                },
                {
                  label: i18n._({ id: 'node.stair.panel.customRise', message: 'Custom rise' }),
                  value: 'custom',
                },
              ]}
              value={node.totalRise == null ? 'follows' : 'custom'}
            />
            {node.totalRise == null ? (
              <div className="px-1 text-[11px] text-muted-foreground">
                {i18n._({
                  id: 'node.panel.currently',
                  message: 'Currently {value}',
                  values: { value: formatLinearMeasurement(resolvedRise, unit, metricNotation) },
                })}
              </div>
            ) : (
              <MetricControl
                label={i18n._({ id: 'node.stair.panel.rise', message: 'Rise' })}
                min={minimumRise}
                onChange={(value) => handleUpdate({ totalRise: value })}
                precision={2}
                step={0.05}
                unit="m"
                value={resolvedRise}
              />
            )}
          </div>

          {riseError?.id === node.id ? (
            <div role="alert" className="text-destructive text-xs">
              {riseError.message}
            </div>
          ) : null}

          {attachedDeck ? null : (
            <>
              <SegmentedControl
                onChange={(value) => handleAutoCutoutChange(value === 'destination')}
                options={STAIR_SLAB_OPENING_OPTIONS.map((option) => ({
                  ...option,
                  label: i18n._(option.label),
                }))}
                value={node.slabOpeningMode ?? 'none'}
              />

              {(node.slabOpeningMode ?? 'none') === 'destination' ? (
                <MetricControl
                  label={i18n._({
                    id: 'node.stair.panel.openingOffset',
                    message: 'Opening Offset',
                  })}
                  min={0}
                  onChange={(value) => handleUpdate({ openingOffset: value })}
                  precision={2}
                  step={0.01}
                  unit="m"
                  value={node.openingOffset ?? 0}
                />
              ) : null}
            </>
          )}

          {node.stairType === 'spiral' && (
            <>
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
                  {i18n._({ id: 'node.stair.panel.landing', message: 'Landing' })}
                </div>
                <SegmentedControl
                  onChange={(value) => handleUpdate({ topLandingMode: value })}
                  options={TOP_LANDING_MODE_OPTIONS.map((option) => ({
                    ...option,
                    label: i18n._(option.label),
                  }))}
                  value={node.topLandingMode ?? 'none'}
                />
              </div>
              {(node.topLandingMode ?? 'none') === 'integrated' && (
                <MetricControl
                  label={i18n._({ id: 'node.stair.panel.topLanding', message: 'Top Landing' })}
                  max={Math.PI * 2 * resolveStairArcDimensions(node, resolvedRise).walkingRadius}
                  min={0.001}
                  onChange={(value) => handleUpdate({ topLandingDepth: value })}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={node.topLandingDepth ?? 0.9}
                />
              )}
            </>
          )}
        </div>
      </PanelSection>

      {node.stairType === 'straight' && (
        <PanelSection title={i18n._({ id: 'node.stair.panel.segments', message: 'Segments' })}>
          <div className="flex flex-col gap-1">
            {segments.map((seg, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={seg.id}
                onClick={() => handleSelectSegment(seg.id)}
                type="button"
              >
                <span className="truncate">
                  {seg.name ||
                    i18n._({
                      id: 'node.segmentNumber',
                      message: 'Segment {number}',
                      values: { number: i + 1 },
                    })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {i18n._({
                    id: 'node.stair.panel.segmentType',
                    message: '{type, select, landing {Landing} other {Stair}}',
                    values: { type: seg.segmentType },
                  })}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.stair.panel.addFlight', message: 'Add flight' })}
              onClick={handleAddFlight}
            />
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.stair.panel.addLanding', message: 'Add landing' })}
              onClick={handleAddLanding}
            />
          </div>
        </PanelSection>
      )}

      {(node.stairType === 'curved' || node.stairType === 'spiral') && (
        <PanelSection title={i18n._({ id: 'node.stair.panel.geometry', message: 'Geometry' })}>
          <MetricControl
            label={i18n._({ id: 'node.stair.panel.width', message: 'Width' })}
            min={0.001}
            onChange={(value) => handleUpdate({ width: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={node.width ?? 1}
          />
          <MetricControl
            label={i18n._({ id: 'node.stair.panel.steps', message: 'Steps' })}
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
              label={i18n._({ id: 'node.stair.panel.fitToFloor', message: 'Fit To Floor' })}
              onChange={(checked) => handleUpdate({ fillToFloor: checked })}
            />
          )}
          {(node.stairType === 'spiral' || !(node.fillToFloor ?? true)) && (
            <MetricControl
              label={i18n._({ id: 'node.stair.panel.thickness', message: 'Thickness' })}
              min={0.001}
              onChange={(value) => handleUpdate({ thickness: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.thickness ?? 0.25}
            />
          )}
          <MetricControl
            label={i18n._({ id: 'node.stair.panel.innerRadius', message: 'Inner Radius' })}
            min={0.001}
            onChange={(value) => handleUpdate({ innerRadius: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={node.innerRadius ?? 0.9}
          />
          <SegmentedControl
            value={node.sweepAngle < 0 ? 'negative' : 'positive'}
            onChange={(value) =>
              handleUpdate({
                sweepAngle: Math.abs(node.sweepAngle) * (value === 'negative' ? -1 : 1),
              })
            }
            options={[
              {
                label: i18n._({ id: 'node.stair.panel.clockwise', message: 'Clockwise' }),
                value: 'positive',
              },
              {
                label: i18n._({
                  id: 'node.stair.panel.counterclockwise',
                  message: 'Counterclockwise',
                }),
                value: 'negative',
              },
            ]}
          />
          <SliderControl
            label={i18n._({ id: 'node.stair.panel.sweep', message: 'Sweep' })}
            min={0.01}
            onChange={(degrees) =>
              handleUpdate({
                sweepAngle: (Math.sign(node.sweepAngle || 1) * (degrees * Math.PI)) / 180,
              })
            }
            precision={0}
            step={1}
            unit="°"
            value={Math.round((Math.abs(node.sweepAngle ?? Math.PI / 2) * 180) / Math.PI)}
          />
          {node.stairType === 'spiral' && (
            <>
              <ToggleControl
                checked={node.showCenterColumn ?? true}
                label={i18n._({ id: 'node.stair.panel.centerColumn', message: 'Center Column' })}
                onChange={(checked) => handleUpdate({ showCenterColumn: checked })}
              />
              <ToggleControl
                checked={node.showStepSupports ?? true}
                label={i18n._({ id: 'node.stair.panel.stepSupports', message: 'Step Supports' })}
                onChange={(checked) => handleUpdate({ showStepSupports: checked })}
              />
            </>
          )}
        </PanelSection>
      )}

      <PanelSection
        title={i18n._({ id: 'node.stair.panel.construction', message: 'Construction' })}
      >
        <StairConstructionControls
          node={node}
          onChange={(construction) => handleUpdate({ construction })}
        />
      </PanelSection>
      <PanelSection title={i18n._({ id: 'node.stair.panel.position', message: 'Position' })}>
        <SliderControl
          label="X"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[0]}
        />
        <SliderControl
          label="Y"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[1]}
        />
        <SliderControl
          label="Z"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[2]}
        />
        <SliderControl
          label={i18n._({ id: 'node.stair.panel.rotation', message: 'Rotation' })}
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

      <PanelSection title={i18n._({ id: 'node.stair.panel.railing', message: 'Railing' })}>
        <StairRailingControls node={node} onChange={handleUpdate} />
        <SegmentedControl
          onChange={(value) => handleUpdate({ railingMode: value })}
          options={RAILING_MODE_OPTIONS.map((option) => ({
            ...option,
            label: i18n._(option.label),
          }))}
          value={node.railingMode ?? 'none'}
        />
        {(node.railingMode ?? 'none') !== 'none' && (
          <>
            <SelectControl
              label={i18n._({ id: 'node.stair.panel.style', message: 'Style' })}
              onChange={(value) =>
                handleUpdate({
                  railingStyle: value,
                  ...(value === 'glass' || value === 'metal' ? { railingPath: 'continuous' } : {}),
                })
              }
              options={RAILING_STYLE_OPTIONS.map((option) => ({
                ...option,
                label: i18n._(option.label),
              }))}
              value={node.railingStyle ?? 'balusters'}
            />
            <SliderControl
              label={i18n._({ id: 'node.stair.panel.height', message: 'Height' })}
              min={0.001}
              onChange={(value) => handleUpdate({ railingHeight: value })}
              precision={2}
              step={0.02}
              unit="m"
              value={node.railingHeight ?? 0.92}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.stair.panel.actions', message: 'Actions' })}>
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.stair.panel.move', message: 'Move' })}
            onClick={handleMove}
          />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.stair.panel.duplicate', message: 'Duplicate' })}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label={i18n._({ id: 'node.stair.panel.delete', message: 'Delete' })}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
