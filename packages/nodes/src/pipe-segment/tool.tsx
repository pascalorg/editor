'use client'

import { type AnyNode, type PipeFittingNode, PipeSegmentNode, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX, useEditor, usePathDraftPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import {
  planPipeBranchTap,
  planPipeCrossAtRunBody,
  planPipeElbowAtPort,
} from '../shared/auto-fitting'
import { ConnectionFeedback } from '../shared/connection-feedback'
import { createRunWallAttachment, type RunSurfaceTarget } from '../shared/distribution-run-contract'
import {
  DistributionRunCursor,
  RUN_PREVIEW_OPACITY,
  type RunConnection,
  type RunPoint,
  runDistanceSquared,
  runSectionHalfSizeM,
  stepNominalRunSize,
  useDistributionRunTool,
} from '../shared/distribution-run-tool'
import { FITTING_CLEARANCE_MESSAGE, hasFittingClearance } from '../shared/fitting-clearance'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { PipeFittingGhost } from '../shared/mep-ghost'
import { PIPE_PRESETS } from '../shared/mep-presets'
import {
  collectScenePorts,
  DWV_PORT_SYSTEMS,
  findNearestPort3D,
  findNearestRunBody3D,
  findRunBodyCrossingSurface,
  type ScenePort,
} from '../shared/ports'
import { RunHangerPreview, RunHangerToggle } from '../shared/run-hanger-controls'
import { currentPipeContinuationSeed, pipeEndpointPort } from './continuation'
import { pipeSegmentDefinition } from './definition'
import { applyPipeGrade } from './slope'

const PIPE_DIAMETERS_IN = [1.25, 1.5, 2, 3, 4, 6] as const
const PORT_SNAP_RADIUS_M = 0.5
const BODY_SNAP_RADIUS_M = 0.3

function findNearbyPort(point: RunPoint): ScenePort | null {
  const ports = collectScenePorts({
    systems: DWV_PORT_SYSTEMS,
    levelId: useViewer.getState().selection.levelId ?? undefined,
  })
  return findNearestPort3D(point, ports, PORT_SNAP_RADIUS_M)
}

const PipeSegmentTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const continuationSeedRef = useRef(currentPipeContinuationSeed())
  const continuationSeed = continuationSeedRef.current
  const hangerDefaults = useEditor((state) => state.toolDefaults['pipe-segment'])
  const autoHangers = Boolean(
    hangerDefaults?.autoHangers ?? continuationSeed?.pipe.autoHangers ?? false,
  )
  const setAutoHangers = (enabled: boolean) => {
    const editor = useEditor.getState()
    editor.setToolDefaults('pipe-segment', {
      ...editor.toolDefaults['pipe-segment'],
      autoHangers: enabled,
    })
  }
  const hangerStyle =
    (hangerDefaults?.hangerStyle ?? continuationSeed?.pipe.hangerStyle) === 'double'
      ? 'double'
      : 'single'
  const setHangerStyle = (style: 'single' | 'double') => {
    const editor = useEditor.getState()
    editor.setToolDefaults('pipe-segment', {
      ...editor.toolDefaults['pipe-segment'],
      hangerStyle: style,
    })
  }
  const hangerStyleRef = useRef<'single' | 'double'>(hangerStyle)
  hangerStyleRef.current = hangerStyle
  const autoHangersRef = useRef(autoHangers)
  autoHangersRef.current = autoHangers
  const pendingPromotionRef = useRef<PipeFittingNode | null>(
    continuationSeed?.promotedFitting ?? null,
  )
  const defaults = pipeSegmentDefinition.defaults() as {
    diameter: number
    pipeMaterial: PipeSegmentNode['pipeMaterial']
    system: PipeSegmentNode['system']
  }
  const [system, setSystem] = useState<'waste' | 'vent'>(
    continuationSeed?.pipe.system ?? defaults.system,
  )
  const [sloped, setSloped] = useState(false)
  const slopePercent = 100 / 48
  const slopeDirection = 1
  const gradeRef = useRef(slopePercent / 100)
  gradeRef.current = (slopeDirection * slopePercent) / 100
  const [diameter, setDiameter] = useState(continuationSeed?.pipe.diameter ?? defaults.diameter)
  const [pipeMaterial, setPipeMaterial] = useState<PipeSegmentNode['pipeMaterial']>(
    continuationSeed?.pipe.pipeMaterial ?? defaults.pipeMaterial,
  )
  const [presetId, setPresetId] = useState('pvc-waste')
  const systemRef = useRef(system)
  systemRef.current = system
  const slopedRef = useRef(sloped)
  slopedRef.current = sloped
  const diameterRef = useRef(diameter)
  diameterRef.current = diameter
  const pipeMaterialRef = useRef(pipeMaterial)
  pipeMaterialRef.current = pipeMaterial

  const applyPreset = (id: string) => {
    const preset = PIPE_PRESETS.find((candidate) => candidate.id === id)
    if (!preset) return
    setPresetId(preset.id)
    setSystem(preset.system)
    setPipeMaterial(preset.pipeMaterial)
    setDiameter(preset.diameter)
    setSloped(preset.sloped)
  }

  const commitSegment = ({
    start: rawStart,
    end,
    startConnection,
    endConnection,
    surfaceTarget,
    previewOnly = false,
  }: {
    start: RunPoint
    end: RunPoint
    startConnection: RunConnection
    endConnection: RunConnection
    surfaceTarget: RunSurfaceTarget | null
    previewOnly?: boolean
  }) => {
    if (!activeLevelId) return null
    const promotedFitting = pendingPromotionRef.current
    const bendPlanFor = (port: ScenePort | null, awayDirection: RunPoint) => {
      if (!port) return null
      const owner = useScene.getState().nodes[port.nodeId]
      if (owner?.type !== 'pipe-segment') return null
      const plan = planPipeElbowAtPort(
        port,
        awayDirection,
        diameterRef.current,
        pipeMaterialRef.current,
      )
      if (!plan) return null
      const path = owner.path.map((point) => [...point] as RunPoint)
      const index = port.id === 'start' ? 0 : path.length - 1
      const neighbor = path[index === 0 ? 1 : index - 1]!
      const original = path[index]!
      const direction: RunPoint = [
        original[0] - neighbor[0],
        original[1] - neighbor[1],
        original[2] - neighbor[2],
      ]
      const hasClearance = hasFittingClearance(neighbor, plan.trimmedPortPoint, direction, 0.05)
      path[index] = plan.trimmedPortPoint
      return {
        ...plan,
        hasClearance,
        trim: { id: port.nodeId, data: { path } as Partial<AnyNode> },
      }
    }

    const start = rawStart
    const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
    if (length < 1e-4) return null
    const direction: RunPoint = [
      (end[0] - start[0]) / length,
      (end[1] - start[1]) / length,
      (end[2] - start[2]) / length,
    ]

    const startBend = bendPlanFor(promotedFitting ? null : startConnection.port, direction)
    const endBend = bendPlanFor(endConnection.port, [-direction[0], -direction[1], -direction[2]])
    const invalidPlan = () =>
      previewOnly
        ? {
            validationMessage: FITTING_CLEARANCE_MESSAGE,
            nextStart: rawStart,
            nextConnection: startConnection,
            previewPipes: [] as PipeSegmentNode[],
            previewFittings: [] as PipeFittingNode[],
          }
        : null
    if (startBend?.hasClearance === false || endBend?.hasClearance === false) return invalidPlan()
    const startBody = startBend ? null : startConnection.body
    const startOwner = startBody ? useScene.getState().nodes[startBody.nodeId] : null
    const startTap =
      startBody && startOwner?.type === 'pipe-segment'
        ? planPipeBranchTap(startOwner, startBody, direction, diameterRef.current)
        : null
    const endBody = endBend ? null : endConnection.body
    const endOwner = endBody ? useScene.getState().nodes[endBody.nodeId] : null
    let endTap =
      endBody && endOwner?.type === 'pipe-segment'
        ? planPipeBranchTap(
            endOwner,
            endBody,
            [-direction[0], -direction[1], -direction[2]],
            diameterRef.current,
          )
        : null
    if (endBody?.nodeId === startBody?.nodeId) endTap = null

    const pipeStart = startBend?.collarPoint ?? startTap?.branchCollar ?? start
    const pipeEnd = endBend?.collarPoint ?? endTap?.branchCollar ?? end
    const bends = [startBend, endBend].filter((plan) => plan !== null)
    const crossHit = surfaceTarget
      ? findRunBodyCrossingSurface(start, end, BODY_SNAP_RADIUS_M, surfaceTarget, {
          kinds: ['pipe-segment'],
        })
      : null
    const crossOwner = crossHit ? useScene.getState().nodes[crossHit.nodeId] : null
    const cross =
      crossHit &&
      crossHit.nodeId !== startBody?.nodeId &&
      crossHit.nodeId !== endBody?.nodeId &&
      crossOwner?.type === 'pipe-segment'
        ? planPipeCrossAtRunBody(crossOwner, crossHit, direction, diameterRef.current)
        : null

    if (
      !hasFittingClearance(pipeStart, pipeEnd, direction, 0.05) ||
      (startBody && !startTap) ||
      (endBody && endBody.nodeId !== startBody?.nodeId && !endTap) ||
      (crossHit &&
        crossHit.nodeId !== startBody?.nodeId &&
        crossHit.nodeId !== endBody?.nodeId &&
        !cross)
    )
      return invalidPlan()
    if (
      cross &&
      (!hasFittingClearance(pipeStart, cross.branchCollarNear, direction, 0.05) ||
        !hasFittingClearance(cross.branchCollarFar, pipeEnd, direction, 0.05))
    )
      return invalidPlan()

    const makePipe = (from: RunPoint, to: RunPoint) =>
      PipeSegmentNode.parse({
        ...pipeSegmentDefinition.defaults(),
        ...useEditor.getState().toolDefaults['pipe-segment'],
        autoHangers: autoHangersRef.current,
        hangerStyle: hangerStyleRef.current,
        name: systemRef.current === 'vent' ? 'Vent' : 'Drain',
        path: [from, to],
        diameter: diameterRef.current,
        pipeMaterial: pipeMaterialRef.current,
        system: systemRef.current,
      })
    const pipes = cross
      ? [
          runDistanceSquared(pipeStart, cross.branchCollarNear) > 0.05 * 0.05
            ? makePipe(pipeStart, cross.branchCollarNear)
            : null,
          runDistanceSquared(cross.branchCollarFar, pipeEnd) > 0.05 * 0.05
            ? makePipe(cross.branchCollarFar, pipeEnd)
            : null,
        ].filter((pipe) => pipe !== null)
      : [makePipe(pipeStart, pipeEnd)]

    const attachPipe = (pipe: PipeSegmentNode): PipeSegmentNode => {
      const wallAttachment =
        surfaceTarget?.kind === 'wall'
          ? createRunWallAttachment(
              surfaceTarget.hostId as Extract<AnyNode['id'], `wall_${string}`>,
              surfaceTarget.side,
              pipe.path[0]!,
              pipe.path.at(-1)!,
              surfaceTarget,
              (diameterRef.current * 0.0254) / 2,
            )
          : undefined
      return { ...pipe, wallAttachment }
    }
    const attachedPipes = pipes.map(attachPipe)

    const changes = {
      create: [
        ...bends.map((plan) => ({
          node: plan.fitting,
          parentId: activeLevelId,
        })),
        ...(startTap
          ? [
              { node: startTap.fitting, parentId: activeLevelId },
              { node: startTap.runTail, parentId: activeLevelId },
            ]
          : []),
        ...(endTap
          ? [
              { node: endTap.fitting, parentId: activeLevelId },
              { node: endTap.runTail, parentId: activeLevelId },
            ]
          : []),
        ...(cross
          ? [
              { node: cross.fitting, parentId: activeLevelId },
              { node: cross.runTail, parentId: activeLevelId },
            ]
          : []),
        ...attachedPipes.map((node) => ({ node, parentId: activeLevelId })),
      ],
      update: [
        ...(promotedFitting
          ? [
              {
                id: promotedFitting.id,
                data: {
                  name: promotedFitting.name,
                  fittingType: promotedFitting.fittingType,
                  rotation: promotedFitting.rotation,
                  diameter2: promotedFitting.diameter2,
                } as Partial<AnyNode>,
              },
            ]
          : []),
        ...bends.map((plan) => plan.trim),
        ...(startTap
          ? [
              startTap.runUpdate as {
                id: AnyNode['id']
                data: Partial<AnyNode>
              },
            ]
          : []),
        ...(endTap ? [endTap.runUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
        ...(cross ? [cross.runUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
      ],
    }
    if (!previewOnly) {
      useScene.getState().applyNodeChanges(changes)
      pendingPromotionRef.current = null
    }
    const nextPipe = attachedPipes.at(-1)
    const nextStart = nextPipe ? nextPipe.path[nextPipe.path.length - 1]! : end
    const nextPort = nextPipe ? pipeEndpointPort(nextPipe, 'end') : endConnection.port
    return {
      validationMessage: null,
      nextStart,
      previewPipes: attachedPipes,
      previewFittings: changes.create
        .map(({ node }) => node)
        .filter((node): node is PipeFittingNode => node.type === 'pipe-fitting'),
      nextConnection: {
        port: nextPort,
        body: nextPort ? null : endConnection.body,
      },
    }
  }

  const run = useDistributionRunTool({
    active: !!activeLevelId,
    levelId: activeLevelId,
    toolName: 'pipe-segment',
    initialStart: continuationSeed
      ? ([
          ...(continuationSeed.port?.position ?? continuationSeed.body?.point ?? [0, 0, 0]),
        ] as RunPoint)
      : null,
    initialConnection: continuationSeed
      ? { port: continuationSeed.port, body: continuationSeed.body }
      : null,
    findPort: findNearbyPort,
    findBody: (point) =>
      findNearestRunBody3D(point, BODY_SNAP_RADIUS_M, {
        kinds: ['pipe-segment'],
        levelId: activeLevelId ?? undefined,
      }),
    surfaceClearance: (surface) => (surface ? runSectionHalfSizeM(diameterRef.current) : 0),
    minimumSegmentLength: 0.05,
    resolveFreeEnd: (start, end, startConnection) => {
      if (!slopedRef.current || systemRef.current !== 'waste') return end
      return applyPipeGrade(start, end, gradeRef.current)
    },
    inheritFromConnection: ({ port, body }) => {
      const ownerId = port?.nodeId ?? body?.nodeId
      const owner = ownerId ? useScene.getState().nodes[ownerId] : null
      if (owner?.type !== 'pipe-segment') return
      setDiameter(owner.diameter)
      setPipeMaterial(owner.pipeMaterial)
      setSystem(owner.system)
    },
    commit: commitSegment,
    onShortcut: (event) => {
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const next = stepNominalRunSize(
          PIPE_DIAMETERS_IN,
          diameterRef.current,
          event.key === ']' ? 1 : -1,
        )
        if (next !== diameterRef.current) setDiameter(next)
        triggerSFX('sfx:grid-snap')
      } else if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault()
        setSystem((value) => (value === 'waste' ? 'vent' : 'waste'))
        triggerSFX('sfx:grid-snap')
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        setSloped((value) => !value)
        triggerSFX('sfx:grid-snap')
      }
    },
  })

  const refreshCursor = run.refreshCursor
  // Slope settings are read through refs by the cursor resolver; refresh after those refs update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settings must refresh a stationary cursor
  useEffect(() => {
    if (!run.altActive) refreshCursor()
  }, [sloped, system, run.altActive, refreshCursor])

  const displayStart = run.start
  const previewPlan =
    run.start && run.cursor
      ? commitSegment({
          start: run.start,
          end: run.cursor,
          startConnection: run.startConnection,
          endConnection: run.endConnection,
          surfaceTarget: run.surfaceTarget,
          previewOnly: true,
        })
      : null

  useEffect(() => {
    usePathDraftPreview
      .getState()
      .setDraft('pipe-segment', displayStart ? [displayStart] : [], run.cursor, {
        autoHangers,
        hangerStyle,
        diameter,
        system,
      })
  }, [autoHangers, hangerStyle, diameter, displayStart, run.cursor, system])
  useEffect(() => () => usePathDraftPreview.getState().clear('pipe-segment'), [])
  useEffect(() => () => useEditor.getState().setToolDefaults('pipe-segment', null), [])

  if (!activeLevelId) return null
  return (
    <LevelOffsetGroup>
      <ConnectionFeedback
        point={run.cursor}
        target={run.endConnection.port}
        levelId={activeLevelId}
        profile={{ diameter, system }}
      />
      <DistributionRunCursor
        surfaceLabel={
          run.surfaceTarget?.kind === 'wall'
            ? 'Wall'
            : run.surfaceTarget?.kind === 'ceiling'
              ? run.surfaceTarget.frame.normal[1] > 0
                ? 'Ceiling top'
                : 'Ceiling underside'
              : run.surfaceTarget?.kind === 'floor'
                ? 'Floor'
                : run.surfaceTarget
                  ? 'Surface'
                  : 'Free space'
        }
        altActive={run.altActive}
        cursor={run.cursor}
        directionMode={run.directionMode}
        extraParts={[{ key: 'diameter', prefix: 'Ø', value: diameter * 0.0254 }]}
        lengthInput={run.lengthInput}
        onLengthInputChange={run.onLengthInputChange}
        onDirectionSelect={run.onDirectionSelect}
        validationMessage={previewPlan?.validationMessage ?? run.validationMessage}
        snapTarget={run.snapTarget}
        start={displayStart}
        startDirection={run.startConnection.port?.direction ?? null}
        status={
          <div
            onPointerDown={(event) => event.stopPropagation()}
            className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/90 px-3 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur"
          >
            {system === 'waste' ? 'Waste' : 'Vent'} · Q system
            <RunHangerToggle
              enabled={autoHangers}
              onChange={setAutoHangers}
              style={hangerStyle}
              onStyleChange={setHangerStyle}
            />
            <select
              className="bg-transparent text-foreground outline-none"
              onChange={(event) => applyPreset(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              style={{ pointerEvents: 'auto' }}
              value={presetId}
            >
              {PIPE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
        }
        unit={unit}
      />
      {run.snapTarget && (
        <mesh layers={EDITOR_LAYER} position={run.snapTarget}>
          <sphereGeometry args={[0.1, 24, 16]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} opacity={0.35} transparent />
        </mesh>
      )}
      {displayStart && (
        <mesh layers={EDITOR_LAYER} position={displayStart}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      )}
      {previewPlan?.previewPipes.map((pipe, index) => (
        <PreviewPipe key={index} a={pipe.path[0]!} b={pipe.path.at(-1)!} diameterIn={diameter} />
      ))}
      {previewPlan?.previewPipes.map((pipe, index) => (
        <RunHangerPreview key={`hanger-${index}`} run={pipe} levelId={activeLevelId} />
      ))}
      {previewPlan?.previewFittings.map((fitting, index) => (
        <PipeFittingGhost key={index} fitting={fitting} />
      ))}
    </LevelOffsetGroup>
  )
}

function PreviewPipe({ a, b, diameterIn }: { a: RunPoint; b: RunPoint; diameterIn: number }) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const direction = new Vector3().subVectors(end, start)
  const length = direction.length()
  if (length < 1e-4) return null
  direction.normalize()
  const midpoint = new Vector3().addVectors(start, end).multiplyScalar(0.5)
  const radius = (diameterIn * 0.0254) / 2
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={midpoint.toArray()}
      ref={(mesh) => {
        if (mesh) mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction)
      }}
    >
      <cylinderGeometry args={[radius, radius, length, 20, 1, false]} />
      <meshBasicMaterial
        color="#818cf8"
        depthTest={false}
        opacity={RUN_PREVIEW_OPACITY}
        transparent
      />
    </mesh>
  )
}

export default PipeSegmentTool
