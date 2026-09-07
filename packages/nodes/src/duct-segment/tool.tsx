'use client'

import {
  type AnyNode,
  type CeilingNode,
  type DuctFittingNode,
  DuctSegmentNode,
  getCeilingAt,
  getCeilingHeightAt,
  resolveCeilingHeight,
  useScene,
} from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX, useEditor, usePathDraftPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type BufferGeometry,
  DoubleSide,
  type Group,
  Matrix4,
  Path,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import {
  planCrossAtRunBody,
  planElbowAtPort,
  planElbowRealign,
  planTeeAtRunBody,
} from '../shared/auto-fitting'
import {
  DistributionRunCursor,
  runDistanceSquared as dist2,
  RUN_PREVIEW_OPACITY as PREVIEW_OPACITY,
  runSectionHalfSizeM,
  stepNominalRunSize,
  useDistributionRunTool,
} from '../shared/distribution-run-tool'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { FittingGhost } from '../shared/mep-ghost'
import {
  collectScenePorts,
  DUCT_PORT_SYSTEMS,
  findNearestPortXZ,
  findNearestRunBodyXZ,
  findRunBodyCrossingXZ,
  type RunBodyHit,
  type ScenePort,
} from '../shared/ports'
import { currentDuctContinuationSeed, ductEndpointPort } from './continuation'
import { ductSegmentDefinition } from './definition'
import { rectSectionAxes, rollToContinueAcrossElbow } from './geometry'

/**
 * Continuous placement tool for duct segments.
 *
 * Mouse-driven model:
 *   - **First click** anchors the segment start (port snap joins onto an
 *     existing run / fitting collar).
 *   - **Second click** commits a two-point duct immediately and keeps the
 *     segment end anchored, so the next click continues the run like wall
 *     drafting. No polyline accumulation, no finish gesture.
 *   - **Auto-elbow**: when either end snapped onto another RUN's open
 *     port at an angle (15–90°, vertical turns included), an elbow
 *     fitting is minted at the joint and the duct pulls back to its
 *     outlet collar — corners get real fittings instead of butt joints.
 *   - **Tee tap**: starting OR ending on the SIDE of an existing run
 *     (centerline snap) splits the trunk, mints a tee at the tap point,
 *     and the branch leaves square from its collar.
 *   - **Cross tap**: drawing a run straight THROUGH the side of an
 *     existing run (interior crossing) splits the trunk, mints a 4-way
 *     cross at the crossing, and the drawn run continues out the far
 *     branch — both fittings inherit the trunk's / branch's profile.
 *   - The in-flight end follows the active snapping mode: `angles` locks
 *     it to the nearest 45° step in XZ from the start (Y stays at the
 *     start's height); `grid`/`lines`/`off` leave it free. Shift cycles
 *     the snapping mode.
 *   - Hold **Alt** → vertical mode. Cursor XZ locks to the start;
 *     vertical mouse motion drives Y. Click commits the riser segment.
 *   - **[ / ]** step the duct diameter through nominal US sizes; the
 *     ghost preview and the committed node both use it.
 *   - **C** toggles ceiling-level placement: each point lands just below
 *     the ceiling actually covering it (duct top hugging that ceiling)
 *     instead of the floor, so a run tracks per-room ceiling heights.
 *     Points not under any ceiling fall back to the floor.
 *   - Esc clears an anchored start point.
 */
/**
 * Nominal US round-duct sizes (inches): 4"–10" in 1" steps, 12"+ in 2"
 * steps — matches what flex and rigid round actually ship in.
 */
const DUCT_DIAMETERS_IN = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20] as const
/** Snap radius (meters) for joining onto an existing duct's start/end. */
const ENDPOINT_SNAP_RADIUS_M = 0.5
/** Snap radius (meters) for tapping the SIDE of an existing run — a tee
 *  is minted there. Tighter than the port radius so run ends keep
 *  priority near their last stretch. */
const BODY_SNAP_RADIUS_M = 0.35
/** Angle step (radians) for the XZ angle lock — 45°. */

/**
 * Cross-section roll for a new rect run leaving `port` along `newDir`,
 * so its profile stays continuous with whatever it joined: a turn
 * re-derives the roll through the (future) elbow, a straight
 * continuation inherits the source's roll as-is. Sources: a rect run's
 * open end, or a rect fitting's open collar (continuity then comes from
 * the leg on the far side of the junction and the rect run mated
 * there). Null when the port doesn't carry a rect orientation. Shared
 * by the ghost preview and the commit so what you see is what lands.
 */
function continuityRollFrom(port: ScenePort | null, newDir: Vector3): number | null {
  if (!port) return null
  const nodes = useScene.getState().nodes
  const owner = nodes[port.nodeId]
  let srcDir: Vector3 | null = null
  let srcRoll = 0
  if (
    (owner?.type === 'hvac-equipment' || owner?.type === 'duct-terminal') &&
    port.shape &&
    port.shape !== 'round'
  ) {
    // The collar mesh is built at the canonical `rectSectionAxes(dir, 0)`
    // basis, so it reads as a source run pointing out along the port with
    // roll 0 — the new leg rolls to continue that across its turn.
    srcDir = new Vector3(...port.direction)
    srcRoll = 0
  } else if (owner?.type === 'duct-segment' && owner.shape !== 'round') {
    srcDir = new Vector3(...port.direction)
    srcRoll = owner.roll
  } else if (
    owner?.type === 'duct-fitting' &&
    owner.shape !== 'round' &&
    owner.fittingType !== 'reducer' &&
    owner.fittingType !== 'transition'
  ) {
    const source = getDuctFittingPorts(owner).find(
      (p) => p.id !== port.id && p.id !== 'branch' && p.id !== 'branch2',
    )
    if (source) {
      srcDir = new Vector3(...source.direction)
      const tol2 = 0.03 * 0.03
      for (const n of Object.values(nodes)) {
        if (n.type !== 'duct-segment' || n.shape === 'round' || n.path.length < 2) continue
        const ends = [n.path[0]!, n.path[n.path.length - 1]!]
        if (ends.some((e) => dist2(e, source.position) <= tol2)) {
          srcRoll = n.roll
          break
        }
      }
    }
  }
  if (!srcDir) return null
  const cross = new Vector3().crossVectors(srcDir, newDir)
  if (cross.lengthSq() < 1e-8) return srcRoll
  return rollToContinueAcrossElbow(srcDir, srcRoll, srcDir, newDir)
}

function continuityRollForRun(
  startPort: ScenePort | null,
  endPort: ScenePort | null,
  dir: Vector3,
): number {
  return continuityRollFrom(startPort, dir) ?? continuityRollFrom(endPort, dir) ?? 0
}

/**
 * Nearest typed port — duct run ends, fitting collars, anything whose
 * kind registers `def.ports` — within snap range of `point` on the XZ
 * plane. Y is ignored for the distance check (grid events ride the floor
 * while ports hang at duct height); the snap adopts the port's full 3D
 * position. The full port is returned so the commit knows what it joined
 * (auto-elbow insertion needs the port's direction and owner).
 */
function findNearbyPort(point: [number, number, number]): ScenePort | null {
  return findNearestPortXZ(
    point,
    collectScenePorts({ systems: DUCT_PORT_SYSTEMS }),
    ENDPOINT_SNAP_RADIUS_M,
  )
}

/** Cross-section the tool draws with (and commits onto the node). Oval
 *  never comes from the Q toggle (round ↔ rect) — it enters by joining
 *  an existing oval run / fitting collar and continuing its profile. */
type DraftProfile = {
  shape: 'round' | 'rect' | 'oval'
  diameter: number
  width: number
  height: number
}

/**
 * Profile to inherit when the segment start snaps onto `port` — joining
 * means continuing that thing: a rect trunk end keeps its W×H, a round
 * run / fitting collar keeps its diameter. Equipment and terminal
 * collars are round at the port's advertised size.
 */
function inheritProfile(port: ScenePort): DraftProfile | null {
  const owner = useScene.getState().nodes[port.nodeId]
  if (!owner) return null
  if (owner.type === 'duct-segment' || owner.type === 'duct-fitting') {
    return {
      shape: owner.shape,
      diameter: Math.min(
        48,
        Math.max(2, owner.type === 'duct-segment' ? owner.diameter : port.diameter),
      ),
      width: owner.width,
      height: owner.height,
    }
  }
  if (owner.type === 'hvac-equipment' || owner.type === 'duct-terminal') {
    const defaults = ductSegmentDefinition.defaults() as DraftProfile
    // Adopt the collar's cross-section so the run leaves a rect / oval
    // plenum as rect / oval (rolled to match in `continuityRollFrom`),
    // falling back to round at the advertised diameter.
    if (port.shape && port.shape !== 'round') {
      return {
        shape: port.shape,
        diameter: Math.min(48, Math.max(2, port.diameter)),
        width: port.width ?? defaults.width,
        height: port.height ?? defaults.height,
      }
    }
    return {
      shape: 'round',
      diameter: Math.min(48, Math.max(2, port.diameter)),
      width: defaults.width,
      height: defaults.height,
    }
  }
  return null
}

/** The full set of nodes a drawn segment produces. The drawn `ducts`
 *  (and any trunk `tails` from a tee / cross split) are previewed by the
 *  duct ghost already; `fittings` are the auto-inserted elbow / tee /
 *  cross nodes the ghost preview draws so the user sees them before the
 *  commit. Shared by `commitSegment` and the live preview so what you see
 *  is exactly what lands. */
type DuctDrawPlan = {
  fittings: DuctFittingNode[]
  ducts: DuctSegmentNode[]
  tails: DuctSegmentNode[]
  updates: { id: AnyNode['id']; data: Partial<AnyNode> }[]
}

const elbowPlanFor = (
  port: ScenePort | null,
  awayDir: [number, number, number],
  profile: DraftProfile,
) => {
  if (!port) return null
  const owner = useScene.getState().nodes[port.nodeId]
  if (owner?.type !== 'duct-segment') return null
  const plan = planElbowAtPort(port, awayDir, profile)
  if (!plan) return null
  // Trim the run's snapped endpoint back to the elbow's inlet collar.
  const path = owner.path.map((p) => [...p] as [number, number, number])
  const index = port.id === 'start' ? 0 : path.length - 1
  const neighbor = path[index === 0 ? 1 : index - 1]!
  const remaining = Math.hypot(
    plan.trimmedPortPoint[0] - neighbor[0],
    plan.trimmedPortPoint[1] - neighbor[1],
    plan.trimmedPortPoint[2] - neighbor[2],
  )
  // The trim must leave a real piece of the existing run AND not flip it.
  const original = path[index]!
  const originalLen = Math.hypot(
    original[0] - neighbor[0],
    original[1] - neighbor[1],
    original[2] - neighbor[2],
  )
  if (remaining < 0.08 || remaining >= originalLen) return null
  path[index] = plan.trimmedPortPoint
  return {
    ...plan,
    trim: { id: port.nodeId, data: { path } as Partial<AnyNode> },
  }
}

const realignPlanFor = (port: ScenePort | null, awayDir: [number, number, number]) => {
  if (!port) return null
  const owner = useScene.getState().nodes[port.nodeId]
  if (owner?.type !== 'duct-fitting') return null
  return planElbowRealign(owner, port.id, awayDir)
}

/**
 * Pure planner for a drawn duct segment: given its endpoints and what
 * each end snapped onto (an open port, or a run body for a tee / cross
 * tap), decide every node the commit creates / updates — auto-inserted
 * elbows / tees / crosses, the drawn run (split in two when it crosses a
 * trunk), trunk tails, and trim / realign updates. Reads the live scene
 * graph but mutates nothing, so the live preview can call it each frame
 * to ghost the fittings before the commit applies the identical plan.
 */
function planDuctDraw(
  start: [number, number, number],
  end: [number, number, number],
  startPort: ScenePort | null,
  startBody: RunBodyHit | null,
  endPort: ScenePort | null,
  endBody: RunBodyHit | null,
  profile: DraftProfile,
): DuctDrawPlan | null {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
  if (length < 1e-4) return null
  const dir: [number, number, number] = [
    (end[0] - start[0]) / length,
    (end[1] - start[1]) / length,
    (end[2] - start[2]) / length,
  ]

  const startPlan = elbowPlanFor(startPort, dir, profile)
  const endPlan = elbowPlanFor(endPort, [-dir[0], -dir[1], -dir[2]], profile)
  const startRealign = startPlan ? null : realignPlanFor(startPort, dir)
  const endRealign = endPlan ? null : realignPlanFor(endPort, [-dir[0], -dir[1], -dir[2]])
  const trunkBody = startPlan ? null : startBody
  const trunkOwner = trunkBody ? useScene.getState().nodes[trunkBody.nodeId] : null
  const teePlan =
    trunkBody && trunkOwner?.type === 'duct-segment'
      ? planTeeAtRunBody(trunkOwner, trunkBody, dir, profile)
      : null
  const endTrunkBody = endPlan || endRealign ? null : endBody
  const endTrunkOwner = endTrunkBody ? useScene.getState().nodes[endTrunkBody.nodeId] : null
  const endTeePlan =
    endTrunkBody && endTrunkOwner?.type === 'duct-segment'
      ? planTeeAtRunBody(endTrunkOwner, endTrunkBody, [-dir[0], -dir[1], -dir[2]], profile)
      : null
  let ductStart =
    startPlan?.collarPoint ?? teePlan?.branchCollar ?? startRealign?.collarPoint ?? start
  let ductEnd = endPlan?.collarPoint ?? endTeePlan?.branchCollar ?? endRealign?.collarPoint ?? end
  const remaining = Math.hypot(
    ductEnd[0] - ductStart[0],
    ductEnd[1] - ductStart[1],
    ductEnd[2] - ductStart[2],
  )
  let plans = [startPlan, endPlan].filter((p) => p !== null)
  let tee = teePlan
  let endTee = endTeePlan && endTrunkBody?.nodeId === trunkBody?.nodeId ? null : endTeePlan
  if (!endTee && endTeePlan) ductEnd = endRealign?.collarPoint ?? end
  let realigns = [startRealign, endRealign].filter((p) => p !== null)

  const crossHit = findRunBodyCrossingXZ(start, end, BODY_SNAP_RADIUS_M)
  const crossOwner = crossHit ? useScene.getState().nodes[crossHit.nodeId] : null
  const crossTappedElsewhere =
    crossHit?.nodeId === trunkBody?.nodeId || crossHit?.nodeId === endTrunkBody?.nodeId
  let cross =
    crossHit && !crossTappedElsewhere && crossOwner?.type === 'duct-segment'
      ? planCrossAtRunBody(crossOwner, crossHit, dir, profile)
      : null

  if (remaining <= 0.08) {
    plans = []
    tee = null
    endTee = null
    realigns = []
    cross = null
    ductStart = start
    ductEnd = end
  }

  // Rect / oval continuity: roll the new run's cross-section so its
  // profile stays continuous with whatever either end joined.
  let roll = 0
  if (profile.shape !== 'round') {
    const newDir = new Vector3(...dir)
    roll = continuityRollForRun(startPort, endPort, newDir)
  }

  const defaults = ductSegmentDefinition.defaults()
  const toolDefaults = useEditor.getState().toolDefaults['duct-segment'] ?? {}
  const makeDuct = (from: [number, number, number], to: [number, number, number]) =>
    DuctSegmentNode.parse({
      ...defaults,
      ...toolDefaults,
      name: profile.shape === 'rect' ? 'Trunk' : 'Duct run',
      path: [from, to],
      shape: profile.shape,
      diameter: profile.diameter,
      width: profile.width,
      height: profile.height,
      roll,
    })
  const ducts = cross
    ? [
        dist2(ductStart, cross.branchCollarNear) > 0.08 * 0.08
          ? makeDuct(ductStart, cross.branchCollarNear)
          : null,
        dist2(cross.branchCollarFar, ductEnd) > 0.08 * 0.08
          ? makeDuct(cross.branchCollarFar, ductEnd)
          : null,
      ].filter((d) => d !== null)
    : [makeDuct(ductStart, ductEnd)]

  const fittings: DuctFittingNode[] = [
    ...plans.map((p) => p.fitting),
    ...(tee ? [tee.fitting] : []),
    ...(endTee ? [endTee.fitting] : []),
    ...(cross ? [cross.fitting] : []),
  ]
  const tails: DuctSegmentNode[] = [
    ...(tee ? [tee.trunkTail] : []),
    ...(endTee ? [endTee.trunkTail] : []),
    ...(cross ? [cross.trunkTail] : []),
  ]
  const updates: { id: AnyNode['id']; data: Partial<AnyNode> }[] = [
    ...plans.map((p) => p.trim),
    ...(tee ? [tee.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
    ...(endTee ? [endTee.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
    ...(cross ? [cross.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
    ...realigns.map((p) => p.update as { id: AnyNode['id']; data: Partial<AnyNode> }),
  ]

  return { fittings, ducts, tails, updates }
}

const DuctSegmentTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const cursorRef = useRef<Group>(null)
  const continuationSeedRef = useRef(currentDuctContinuationSeed())
  const continuationSeed = continuationSeedRef.current
  const pendingPromotionRef = useRef(continuationSeed?.promotedFitting ?? null)
  const [profile, setProfile] = useState<DraftProfile>(() => {
    const defaults = ductSegmentDefinition.defaults() as DraftProfile
    const seeded = useEditor.getState().toolDefaults['duct-segment'] as
      | Partial<DraftProfile>
      | undefined
    return {
      shape: continuationSeed?.duct.shape ?? seeded?.shape ?? defaults.shape,
      diameter: continuationSeed?.duct.diameter ?? seeded?.diameter ?? defaults.diameter,
      width: continuationSeed?.duct.width ?? seeded?.width ?? defaults.width,
      height: continuationSeed?.duct.height ?? seeded?.height ?? defaults.height,
    }
  })
  const [ceilingMode, setCeilingMode] = useState(false)
  const [hoverCeiling, setHoverCeiling] = useState<CeilingNode | null>(null)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const ceilingModeRef = useRef(ceilingMode)
  ceilingModeRef.current = ceilingMode

  const floorCenterlineY = (): number => {
    const current = profileRef.current
    const verticalIn = current.shape === 'round' ? current.diameter : current.height
    return runSectionHalfSizeM(verticalIn)
  }

  const resolveCeilingY = (x: number, z: number): number => {
    const floorY = floorCenterlineY()
    if (!ceilingModeRef.current || !activeLevelId) return floorY
    const ceiling = getCeilingHeightAt(activeLevelId, useScene.getState().nodes, x, z)
    if (ceiling === null) return floorY
    return Math.max(floorY, ceiling - floorY)
  }

  const run = useDistributionRunTool({
    active: !!activeLevelId,
    initialStart: continuationSeed
      ? ([...continuationSeed.port.position] as [number, number, number])
      : null,
    initialConnection: continuationSeed ? { port: continuationSeed.port, body: null } : null,
    findPort: findNearbyPort,
    findBody: (point) => findNearestRunBodyXZ(point, BODY_SNAP_RADIUS_M),
    resolveFirstY: resolveCeilingY,
    minimumFreeY: floorCenterlineY,
    resolveFreeEnd: (_start, end) => [
      end[0],
      ceilingModeRef.current ? resolveCeilingY(end[0], end[2]) : end[1],
      end[2],
    ],
    inheritFromConnection: ({ port }) => {
      if (!port) return
      const inherited = inheritProfile(port)
      if (inherited) setProfile(inherited)
    },
    commit: ({ start, end, startConnection, endConnection }) => {
      if (!activeLevelId) return null
      const promotedFitting = pendingPromotionRef.current
      const plan = planDuctDraw(
        start,
        end,
        promotedFitting ? null : startConnection.port,
        startConnection.body,
        endConnection.port,
        endConnection.body,
        profileRef.current,
      )
      if (!plan) return null
      useScene.getState().applyNodeChanges({
        create: [
          ...plan.fittings.map((node) => ({ node, parentId: activeLevelId })),
          ...plan.tails.map((node) => ({ node, parentId: activeLevelId })),
          ...plan.ducts.map((node) => ({ node, parentId: activeLevelId })),
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
                    branchAngle: promotedFitting.branchAngle,
                    shape2: promotedFitting.shape2,
                    width2: promotedFitting.width2,
                    height2: promotedFitting.height2,
                    diameter2: promotedFitting.diameter2,
                  } as Partial<AnyNode>,
                },
              ]
            : []),
          ...plan.updates,
        ],
      })
      pendingPromotionRef.current = null
      const nextDuct = plan.ducts.at(-1)
      const nextStart = nextDuct ? nextDuct.path[nextDuct.path.length - 1]! : end
      const nextPort = nextDuct ? ductEndpointPort(nextDuct, 'end') : endConnection.port
      return {
        nextStart,
        nextConnection: {
          port: nextPort,
          body: nextPort ? null : endConnection.body,
        },
      }
    },
    onCursorPoint: (point) => {
      if (!ceilingModeRef.current || !activeLevelId) {
        setHoverCeiling(null)
        return
      }
      setHoverCeiling(getCeilingAt(activeLevelId, useScene.getState().nodes, point[0], point[2]))
    },
    onClear: () => setHoverCeiling(null),
    onShortcut: (event, start) => {
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const next = stepNominalRunSize(
          DUCT_DIAMETERS_IN,
          profileRef.current.diameter,
          event.key === ']' ? 1 : -1,
        )
        if (next !== profileRef.current.diameter) {
          setProfile((current) => ({ ...current, diameter: next }))
          triggerSFX('sfx:grid-snap')
        }
      } else if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault()
        setProfile((current) => ({
          ...current,
          shape: current.shape === 'round' ? 'rect' : 'round',
        }))
        triggerSFX('sfx:grid-snap')
      } else if ((event.key === 'c' || event.key === 'C') && !start) {
        event.preventDefault()
        setCeilingMode((value) => !value)
        setHoverCeiling(null)
        triggerSFX('sfx:grid-snap')
      }
    },
  })

  const ghostFittings = useMemo(() => {
    if (!(activeLevelId && run.start && run.cursor) || run.altActive) return []
    const fittings =
      planDuctDraw(
        run.start,
        run.cursor,
        pendingPromotionRef.current ? null : run.startConnection.port,
        run.startConnection.body,
        run.endConnection.port,
        run.endConnection.body,
        profile,
      )?.fittings ?? []
    return fittings.map(
      (fitting, index): DuctFittingNode => ({
        ...fitting,
        id: `duct-fitting_live-draft-${index}`,
        parentId: activeLevelId,
      }),
    )
  }, [
    activeLevelId,
    profile,
    run.altActive,
    run.cursor,
    run.endConnection,
    run.start,
    run.startConnection,
  ])

  useEffect(() => {
    usePathDraftPreview
      .getState()
      .setDraft('duct-segment', run.start ? [run.start] : [], run.cursor, profile, ghostFittings)
  }, [ghostFittings, profile, run.cursor, run.start])
  useEffect(() => () => usePathDraftPreview.getState().clear('duct-segment'), [])
  useEffect(() => () => useEditor.getState().setToolDefaults('duct-segment', null), [])

  if (!activeLevelId) return null
  const extraParts =
    profile.shape === 'round'
      ? [{ key: 'diameter', prefix: 'Ø', value: profile.diameter * 0.0254 }]
      : [
          { key: 'trunk-w', prefix: 'W', value: profile.width * 0.0254 },
          { key: 'trunk-h', prefix: 'H', value: profile.height * 0.0254 },
        ]

  return (
    <LevelOffsetGroup>
      {ceilingMode && hoverCeiling && <CeilingHighlight ceiling={hoverCeiling} />}
      <DistributionRunCursor
        altActive={run.altActive}
        cursor={run.cursor}
        cursorRef={cursorRef}
        directionMode={run.directionMode}
        extraParts={extraParts}
        snapTarget={run.snapTarget}
        start={run.start}
        startDirection={run.startConnection.port?.direction ?? null}
        status={
          ceilingMode && !run.start ? (
            <div className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
              Ceiling · C to toggle
            </div>
          ) : undefined
        }
        unit={unit}
      />
      {run.start && (
        <mesh layers={EDITOR_LAYER} position={run.start}>
          <sphereGeometry args={[0.07, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      )}
      {run.start && run.cursor && (
        <PreviewSegment
          a={run.start}
          b={run.cursor}
          endPort={run.endConnection.port}
          profile={profile}
          startPort={run.startConnection.port}
        />
      )}
      {ghostFittings.map((fitting) => (
        <FittingGhost fitting={fitting} key={fitting.id} />
      ))}
    </LevelOffsetGroup>
  )
}

/**
 * Build a horizontal `ShapeGeometry` for a ceiling polygon (with holes) in
 * level-local XZ, laid flat in the XZ plane. Mirrors the ceiling renderer /
 * move-tool convention (Z negated, then rotated onto the floor plane).
 */
function buildCeilingShape(
  polygon: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
): BufferGeometry | null {
  if (polygon.length < 3) return null
  const shape = new Shape()
  const first = polygon[0]!
  shape.moveTo(first[0], -first[1])
  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i]!
    shape.lineTo(pt[0], -pt[1])
  }
  shape.closePath()
  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue
    const hole = new Path()
    const hf = holePolygon[0]!
    hole.moveTo(hf[0], -hf[1])
    for (let i = 1; i < holePolygon.length; i++) {
      const pt = holePolygon[i]!
      hole.lineTo(pt[0], -pt[1])
    }
    hole.closePath()
    shape.holes.push(hole)
  }
  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * Translucent overlay of the ceiling the cursor is under, drawn at the
 * ceiling's own height. Gives the in-flight duct point a real surface to
 * read against, so "hung against the ceiling" is visible from any angle
 * instead of being a dot floating in space.
 */
function CeilingHighlight({ ceiling }: { ceiling: CeilingNode }) {
  const geometry = useMemo(
    () => buildCeilingShape(ceiling.polygon, ceiling.holes),
    [ceiling.polygon, ceiling.holes],
  )
  const outline = useMemo(() => {
    if (ceiling.polygon.length < 2) return null
    const pts = ceiling.polygon.map(([x, z]) => new Vector3(x, 0, z))
    const f = ceiling.polygon[0]!
    pts.push(new Vector3(f[0], 0, f[1]))
    return pts
  }, [ceiling.polygon])
  if (!geometry) return null
  const y = resolveCeilingHeight(ceiling, useScene.getState().nodes)
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={geometry} layers={EDITOR_LAYER} renderOrder={1}>
        <meshBasicMaterial
          color="#818cf8"
          depthWrite={false}
          opacity={0.15}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {outline && (
        <line>
          <bufferGeometry
            ref={(g) => {
              if (g) g.setFromPoints(outline)
            }}
          />
          <lineBasicMaterial color="#818cf8" opacity={0.6} transparent />
        </line>
      )}
    </group>
  )
}

function PreviewSegment({
  a,
  b,
  profile,
  startPort,
  endPort,
}: {
  a: [number, number, number]
  b: [number, number, number]
  profile: DraftProfile
  startPort: ScenePort | null
  endPort: ScenePort | null
}) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)

  // Rect AND oval ghost as a box — close enough for a translucent guide.
  if (profile.shape !== 'round') {
    const w = profile.width * 0.0254
    const h = profile.height * 0.0254
    return (
      <mesh
        layers={EDITOR_LAYER}
        position={mid.toArray()}
        ref={(m) => {
          if (!m) return
          // Same basis AND roll as the commit will use, so the ghost
          // shows the orientation that actually lands.
          const roll = continuityRollForRun(startPort, endPort, dir)
          const { width: x, height: z } = rectSectionAxes(dir, roll)
          m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, dir, z))
        }}
      >
        <boxGeometry args={[w, length, h]} />
        <meshBasicMaterial
          color="#818cf8"
          depthTest={false}
          opacity={PREVIEW_OPACITY}
          transparent
        />
      </mesh>
    )
  }

  const radius = (profile.diameter * 0.0254) / 2
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={mid.toArray()}
      ref={(m) => {
        if (!m) return
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      }}
    >
      <cylinderGeometry args={[radius, radius, length, 24, 1, false]} />
      <meshBasicMaterial color="#818cf8" depthTest={false} opacity={PREVIEW_OPACITY} transparent />
    </mesh>
  )
}

export default DuctSegmentTool
