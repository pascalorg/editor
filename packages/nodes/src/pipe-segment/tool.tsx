'use client'

import { type AnyNode, type PipeFittingNode, PipeSegmentNode } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  triggerSFX,
  useEditor,
  usePathDraftPreview,
  useRegistryToolContext,
} from '@pascal-app/editor'
import {
  collectScenePorts,
  createRunWallAttachment,
  DistributionRunCursor,
  findNearestRunBody3D,
  findRunBodyCrossingSurface,
  RUN_PREVIEW_OPACITY,
  type RunConnection,
  type RunPoint,
  type RunSurfaceTarget,
  runDistanceSquared,
  type ScenePort,
  stepNominalRunSize,
  useDistributionRunTool,
} from '@pascal-app/editor/distribution'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import {
  planPipeBranchTap,
  planPipeCrossAtRunBody,
  planPipeElbowAtPort,
} from '../shared/auto-fitting'
import {
  createPipeRunEndCap,
  findMatedRunEndCapIds,
  isRunEndCapPort,
} from '../shared/automatic-run-end-cap'
import { ConnectionFeedback } from '../shared/connection-feedback'
import { FITTING_CLEARANCE_MESSAGE, hasFittingClearance } from '../shared/fitting-clearance'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { PipeFittingGhost } from '../shared/mep-ghost'
import { DWV_PORT_SYSTEMS, runSectionHalfSizeM } from '../shared/port-systems'
import { RunHangerPreview } from '../shared/run-hanger-controls'
import { useRunHangerMode } from '../shared/run-hanger-mode'
import { clearRunContinuation, updateRunDefaults } from '../shared/run-tool-options'
import { planPipeCollarConnection } from './collar-connection'
import { currentPipeContinuationSeed, pipeEndpointPort } from './continuation'
import { pipeSegmentDefinition } from './definition'
import { applyPipeGrade, pipeGrade, pipeGradeLabel } from './slope'

const PIPE_DIAMETERS_IN = [1.25, 1.5, 2, 3, 4, 6] as const
const BODY_SNAP_RADIUS_M = 0.3

function getConnectionPorts(
  levelId: AnyNode['id'] | null,
  nodes: Readonly<Record<string, AnyNode>>,
): ScenePort[] {
  return collectScenePorts({
    systems: DWV_PORT_SYSTEMS,
    levelId: levelId ?? undefined,
  }).filter((port) => !isRunEndCapPort(port, nodes))
}

const PipeSegmentTool = () => {
  const { activeLevelId, sceneApi, unit } = useRegistryToolContext()
  const toolDefaults = useEditor((s) => s.toolDefaults['pipe-segment']) as
    | Partial<PipeSegmentNode>
    | undefined
  const continuationSeedRef = useRef(currentPipeContinuationSeed())
  const continuationSeed = continuationSeedRef.current
  const hangerDefaults = useEditor((state) => state.toolDefaults['pipe-segment'])
  const initialAutoHangersRef = useRef(
    Boolean(hangerDefaults?.autoHangers ?? continuationSeed?.pipe.autoHangers ?? false),
  )
  const autoHangers = useRunHangerMode((state) => state.enabled['pipe-segment'])
  const hangerStyle =
    (hangerDefaults?.hangerStyle ?? continuationSeed?.pipe.hangerStyle) === 'double'
      ? 'double'
      : 'single'
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
  const system = toolDefaults?.system ?? continuationSeed?.pipe.system ?? defaults.system
  const setSystem = (
    value:
      | PipeSegmentNode['system']
      | ((current: PipeSegmentNode['system']) => PipeSegmentNode['system']),
  ) =>
    updateRunDefaults('pipe-segment', {
      system: typeof value === 'function' ? value(system) : value,
    })
  const sloped = hangerDefaults?.fall === 'sloped'
  const setSloped = (value: (current: boolean) => boolean) =>
    updateRunDefaults('pipe-segment', { fall: value(sloped) ? 'sloped' : 'level' })
  const slopePercent =
    typeof hangerDefaults?.gradePercent === 'number' ? hangerDefaults.gradePercent : 100 / 48
  const slopeDirection = hangerDefaults?.flowDirection === 'reverse' ? -1 : 1
  const gradeRef = useRef(slopePercent / 100)
  gradeRef.current = (slopeDirection * slopePercent) / 100
  const diameter = toolDefaults?.diameter ?? continuationSeed?.pipe.diameter ?? defaults.diameter
  const setDiameter = (diameter: number) => updateRunDefaults('pipe-segment', { diameter })
  const pipeMaterial =
    toolDefaults?.pipeMaterial ?? continuationSeed?.pipe.pipeMaterial ?? defaults.pipeMaterial
  const setPipeMaterial = (pipeMaterial: PipeSegmentNode['pipeMaterial']) =>
    updateRunDefaults('pipe-segment', { pipeMaterial })
  const systemRef = useRef(system)
  systemRef.current = system
  const slopedRef = useRef(sloped)
  slopedRef.current = sloped
  const diameterRef = useRef(diameter)
  diameterRef.current = diameter
  const pipeMaterialRef = useRef(pipeMaterial)
  pipeMaterialRef.current = pipeMaterial

  useEffect(() => {
    const mode = useRunHangerMode.getState()
    mode.setEnabled('pipe-segment', initialAutoHangersRef.current)
    return () => {
      updateRunDefaults('pipe-segment', {
        autoHangers: useRunHangerMode.getState().enabled['pipe-segment'],
      })
      mode.setEnabled('pipe-segment', false)
    }
  }, [])

  useEffect(() => {
    if (continuationSeed)
      updateRunDefaults('pipe-segment', {
        system: continuationSeed.pipe.system,
        diameter: continuationSeed.pipe.diameter,
        pipeMaterial: continuationSeed.pipe.pipeMaterial,
      })
  }, [continuationSeed])

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
      const owner = sceneApi.get(port.nodeId)
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
    const invalidPlan = (message = FITTING_CLEARANCE_MESSAGE) =>
      previewOnly
        ? {
            validationMessage: message,
            nextStart: rawStart,
            nextConnection: startConnection,
            previewPipes: [] as PipeSegmentNode[],
            previewFittings: [] as PipeFittingNode[],
          }
        : null
    const fixedConnection = (port: ScenePort | null, toward: RunPoint) => {
      const owner = port && sceneApi.get(port.nodeId)
      return port && owner && owner.type !== 'pipe-segment'
        ? planPipeCollarConnection(
            sceneApi.nodes(),
            port,
            toward,
            diameterRef.current,
            systemRef.current,
            pipeMaterialRef.current,
          )
        : null
    }
    let startCollar: ReturnType<typeof fixedConnection>,
      endCollar: ReturnType<typeof fixedConnection>
    try {
      startCollar = fixedConnection(promotedFitting ? null : startConnection.port, end)
      endCollar = fixedConnection(endConnection.port, start)
    } catch (error) {
      return invalidPlan(error instanceof Error ? error.message : 'Unable to connect collar.')
    }
    const actualGrade = pipeGrade(start, end)
    if (
      slopedRef.current &&
      systemRef.current === 'waste' &&
      actualGrade !== null &&
      Math.abs(actualGrade - gradeRef.current) > 1e-5
    )
      return invalidPlan(
        'The connection elevation conflicts with the chosen grade. Adjust the grade or target elevation.',
      )
    if (startBend?.hasClearance === false || endBend?.hasClearance === false) return invalidPlan()
    const startBody = startBend ? null : startConnection.body
    const startOwner = startBody ? sceneApi.get(startBody.nodeId) : null
    const startTap =
      startBody && startOwner?.type === 'pipe-segment'
        ? planPipeBranchTap(startOwner, startBody, direction, diameterRef.current)
        : null
    const endBody = endBend ? null : endConnection.body
    const endOwner = endBody ? sceneApi.get(endBody.nodeId) : null
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

    const pipeStart =
      startBend?.collarPoint ?? startTap?.branchCollar ?? startCollar?.point ?? start
    const pipeEnd = endBend?.collarPoint ?? endTap?.branchCollar ?? endCollar?.point ?? end
    const bends = [startBend, endBend].filter((plan) => plan !== null)
    const crossHit =
      surfaceTarget && hangerDefaults?.crossingMode !== 'cross'
        ? findRunBodyCrossingSurface(start, end, BODY_SNAP_RADIUS_M, surfaceTarget, {
            kinds: ['pipe-segment'],
          })
        : null
    const crossOwner = crossHit ? sceneApi.get(crossHit.nodeId) : null
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
    if (
      slopedRef.current &&
      systemRef.current === 'waste' &&
      attachedPipes.some((pipe) => {
        const grade = pipeGrade(pipe.path[0]!, pipe.path.at(-1)!)
        return grade !== null && Math.abs(grade - gradeRef.current) > 1e-5
      })
    )
      return invalidPlan(
        'The fitting collars cannot maintain the chosen grade. Adjust the connection or grade.',
      )
    const sceneNodes = sceneApi.nodes()
    const consumedEndCapIds = Array.from(
      new Set([
        ...findMatedRunEndCapIds(startConnection.port, sceneNodes, 'pipe-fitting'),
        ...findMatedRunEndCapIds(endConnection.port, sceneNodes, 'pipe-fitting'),
      ]),
    )
    const firstPipe = attachedPipes[0]
    const nextPipe = attachedPipes.at(-1)
    const startEndCap =
      firstPipe && !startConnection.port && !startConnection.body
        ? createPipeRunEndCap(firstPipe, 'start')
        : null
    const nextEndCap =
      nextPipe && !endConnection.port && !endConnection.body ? createPipeRunEndCap(nextPipe) : null

    const changes = {
      create: [
        ...[...(startCollar?.fittings ?? []), ...(endCollar?.fittings ?? [])].map((node) => ({
          node,
          parentId: activeLevelId,
        })),
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
        ...(startEndCap ? [{ node: startEndCap, parentId: activeLevelId }] : []),
        ...(nextEndCap ? [{ node: nextEndCap, parentId: activeLevelId }] : []),
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
      delete: consumedEndCapIds,
    }
    if (!previewOnly) {
      if (!sceneApi.applyChanges) throw new Error('Registry SceneApi must support atomic changes')
      sceneApi.applyChanges(changes)
      pendingPromotionRef.current = null
    }
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
    routingMode:
      hangerDefaults?.routingMode === 'horizontal' || hangerDefaults?.routingMode === 'vertical'
        ? hangerDefaults.routingMode
        : 'surface',
    elevation: typeof hangerDefaults?.elevation === 'number' ? hangerDefaults.elevation : 0,
    targetElevation:
      typeof hangerDefaults?.targetElevation === 'number' ? hangerDefaults.targetElevation : 3,
    connectCrossings: hangerDefaults?.crossingMode !== 'cross',
    initialStart: continuationSeed
      ? ([
          ...(continuationSeed.port?.position ?? continuationSeed.body?.point ?? [0, 0, 0]),
        ] as RunPoint)
      : null,
    initialConnection: continuationSeed
      ? { port: continuationSeed.port, body: continuationSeed.body }
      : null,
    getPorts: () => getConnectionPorts(activeLevelId, sceneApi.nodes()),
    findBody: (point) =>
      findNearestRunBody3D(point, BODY_SNAP_RADIUS_M, {
        kinds: ['pipe-segment'],
        levelId: activeLevelId ?? undefined,
      }),
    surfaceClearance: (surface) => (surface ? runSectionHalfSizeM(diameterRef.current) : 0),
    minimumSegmentLength: 0.05,
    resolveFreeEnd: (start, end, startConnection) => {
      const port = startConnection.port
      if (
        port &&
        sceneApi.get(port.nodeId)?.type !== 'pipe-segment' &&
        !pendingPromotionRef.current
      ) {
        const axis = new Vector3(...port.direction).normalize()
        const distance = Math.max(0, new Vector3(...end).sub(new Vector3(...start)).dot(axis))
        return new Vector3(...start).addScaledVector(axis, distance).toArray() as RunPoint
      }
      if (!slopedRef.current || systemRef.current !== 'waste') return end
      return applyPipeGrade(start, end, gradeRef.current)
    },
    inheritFromConnection: ({ port, body }) => {
      const ownerId = port?.nodeId ?? body?.nodeId
      const owner = ownerId ? sceneApi.get(ownerId) : null
      if (owner?.type !== 'pipe-segment') {
        if (port && (port.system === 'waste' || port.system === 'vent')) {
          setDiameter(port.diameter)
          setSystem(port.system)
          if (owner && 'pipeMaterial' in owner) setPipeMaterial(owner.pipeMaterial)
          const grade = pipeGrade([0, 0, 0], [...port.direction]) ?? 0
          updateRunDefaults('pipe-segment', {
            fall: Math.abs(grade) > 1e-6 ? 'sloped' : 'level',
            gradePercent: Math.abs(grade) * 100,
            flowDirection: grade < 0 ? 'reverse' : 'forward',
          })
        }
        return
      }
      setDiameter(owner.diameter)
      setPipeMaterial(owner.pipeMaterial)
      setSystem(owner.system)
      const index = body?.segmentIndex ?? (port?.id === 'start' ? 0 : owner.path.length - 2)
      const grade = pipeGrade(owner.path[index]!, owner.path[index + 1]!)
      if (grade !== null) {
        const inherited = port?.id === 'start' ? -grade : grade
        updateRunDefaults('pipe-segment', {
          fall: Math.abs(grade) > 1e-6 ? 'sloped' : 'level',
          gradePercent: Math.abs(grade) * 100,
          flowDirection: inherited < 0 ? 'reverse' : 'forward',
        })
      }
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
      } else if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        useRunHangerMode.getState().toggle('pipe-segment')
        triggerSFX('sfx:grid-snap')
      }
    },
  })

  const refreshCursor = run.refreshCursor
  // Slope settings are read through refs by the cursor resolver; refresh after those refs update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settings must refresh a stationary cursor
  useEffect(() => {
    if (!run.altActive) refreshCursor()
  }, [sloped, slopePercent, slopeDirection, system, diameter, run.altActive, refreshCursor])

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
  useEffect(() => () => clearRunContinuation('pipe-segment'), [])

  if (!activeLevelId) return null
  return (
    <LevelOffsetGroup>
      <ConnectionFeedback
        detail={
          displayStart && run.cursor
            ? `${pipeGradeLabel(displayStart, run.cursor)} · Start ${displayStart[1].toFixed(3)} m · End ${run.cursor[1].toFixed(3)} m above level`
            : undefined
        }
        point={run.cursor}
        target={run.endConnection.port}
        screen={run.snapScreen ?? run.cursorScreen}
        error={
          run.cursorScreen ? (previewPlan?.validationMessage ?? run.validationMessage) : undefined
        }
        levelId={activeLevelId}
        profile={{ diameter, system }}
      />
      <DistributionRunCursor
        altActive={run.altActive}
        cursor={run.cursor}
        directionMode={run.directionMode}
        routingMode={run.routingMode}
        extraParts={[{ key: 'diameter', prefix: 'Ø', value: diameter * 0.0254 }]}
        lengthInput={run.lengthInput}
        onLengthInputChange={run.onLengthInputChange}
        onDirectionSelect={run.onDirectionSelect}
        validationMessage={previewPlan?.validationMessage ?? run.validationMessage}
        snapTarget={run.snapTarget}
        snapScreen={run.snapScreen}
        start={displayStart}
        startDirection={run.startConnection.port?.direction ?? null}
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
