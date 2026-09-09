'use client'

import { type AnyNode, type DuctFittingNode, DuctSegmentNode, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX, useEditor, usePathDraftPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, type Group, Vector3 } from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import {
  planCrossAtRunBody,
  planElbowAtPort,
  planElbowRealign,
  planTeeAtRunBody,
} from '../shared/auto-fitting'
import { ConnectionFeedback } from '../shared/connection-feedback'
import { createRunWallAttachment, type RunSurfaceTarget } from '../shared/distribution-run-contract'
import {
  DistributionRunCursor,
  runDistanceSquared as dist2,
  runSectionHalfSizeM,
  stepNominalRunSize,
  useDistributionRunTool,
} from '../shared/distribution-run-tool'
import { ductProfilesMatch, planDuctAdapter } from '../shared/duct-adapter'
import { FITTING_CLEARANCE_MESSAGE, hasFittingClearance } from '../shared/fitting-clearance'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { DuctSegmentGhost, FittingGhost } from '../shared/mep-ghost'
import {
  collectScenePorts,
  DUCT_PORT_SYSTEMS,
  findNearestPort3D,
  findNearestRunBody3D,
  findRunBodyCrossingSurface,
  type RunBodyHit,
  type ScenePort,
} from '../shared/ports'
import { RunHangerPreview, RunHangerToggle } from '../shared/run-hanger-controls'
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
  if (owner?.type === 'duct-fitting' && ['reducer', 'transition'].includes(owner.fittingType)) {
    const width = new Vector3(0, 0, 1).applyEuler(new Euler(...owner.rotation))
    const basis = rectSectionAxes(newDir)
    return Math.atan2(width.dot(basis.height), width.dot(basis.width))
  }
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
  if (cross.lengthSq() < 1e-8) {
    if (owner?.type === 'duct-segment') {
      const i = port.id === 'start' ? 0 : owner.path.length - 2
      const direction = new Vector3(...owner.path[i + 1]!).sub(new Vector3(...owner.path[i]!))
      const width = rectSectionAxes(direction, owner.roll).width
      const basis = rectSectionAxes(newDir)
      return Math.atan2(width.dot(basis.height), width.dot(basis.width))
    }
    return srcRoll
  }
  return rollToContinueAcrossElbow(srcDir, srcRoll, srcDir, newDir)
}

function continuityRollForRun(
  startPort: ScenePort | null,
  endPort: ScenePort | null,
  dir: Vector3,
): number {
  return continuityRollFrom(startPort, dir) ?? continuityRollFrom(endPort, dir) ?? 0
}

function findNearbyPort(point: [number, number, number]): ScenePort | null {
  const ports = collectScenePorts({
    systems: DUCT_PORT_SYSTEMS,
    levelId: useViewer.getState().selection.levelId ?? undefined,
  })
  return findNearestPort3D(point, ports, ENDPOINT_SNAP_RADIUS_M)
}

/** Cross-section shared by the drawn run and its fitting preview. */
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
      shape: port.shape ?? owner.shape,
      diameter: Math.min(
        48,
        Math.max(2, owner.type === 'duct-segment' ? owner.diameter : port.diameter),
      ),
      width: port.width ?? owner.width,
      height: port.height ?? owner.height,
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
  validationMessage: string | null
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
  const source = inheritProfile(port) ?? profile
  const plan = planElbowAtPort(port, awayDir, source)
  if (!plan) return null
  // Trim the run's snapped endpoint back to the elbow's inlet collar.
  const path = owner.path.map((p) => [...p] as [number, number, number])
  const index = port.id === 'start' ? 0 : path.length - 1
  const neighbor = path[index === 0 ? 1 : index - 1]!
  const original = path[index]!
  const direction: [number, number, number] = [
    original[0] - neighbor[0],
    original[1] - neighbor[1],
    original[2] - neighbor[2],
  ]
  const hasClearance = hasFittingClearance(neighbor, plan.trimmedPortPoint, direction, 0.08)
  path[index] = plan.trimmedPortPoint
  return {
    ...plan,
    hasClearance,
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
export function planDuctDraw(
  start: [number, number, number],
  end: [number, number, number],
  startPort: ScenePort | null,
  startBody: RunBodyHit | null,
  endPort: ScenePort | null,
  endBody: RunBodyHit | null,
  profile: DraftProfile,
  surface?: RunSurfaceTarget | null,
  autoHangers = false,
  toolDefaults = useEditor.getState().toolDefaults['duct-segment'] ?? {},
  hangerStyle: 'single' | 'double' = 'single',
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
  const invalidPlan = (): DuctDrawPlan => ({
    validationMessage: FITTING_CLEARANCE_MESSAGE,
    fittings: [],
    ducts: [],
    tails: [],
    updates: [],
  })
  if (startPlan?.hasClearance === false || endPlan?.hasClearance === false) return invalidPlan()
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
  const adapterFor = (
    port: ScenePort | null,
    corner: ReturnType<typeof elbowPlanFor>,
    away: [number, number, number],
  ) => {
    if (!port) return null
    const source = inheritProfile(port)
    if (!source) return null
    const axis = new Vector3(...away)
    if (!corner && axis.dot(new Vector3(...port.direction).normalize()) < 0.9999) return null
    const owner = useScene.getState().nodes[port.nodeId]
    const roll = continuityRollFrom(port, axis) ?? 0
    const width = rectSectionAxes(axis, roll).width
    if (owner?.type === 'duct-fitting' && !corner) {
      width.set(0, 0, 1).applyEuler(new Euler(...owner.rotation))
    }
    return planDuctAdapter(
      { ...port, position: corner?.collarPoint ?? port.position, direction: away },
      source,
      profile,
      width,
    )
  }
  const startAdapter = adapterFor(startPort, startPlan, dir)
  const endAdapter = adapterFor(endPort, endPlan, [-dir[0], -dir[1], -dir[2]])
  for (const [port, adapter] of [
    [startPort, startAdapter],
    [endPort, endAdapter],
  ] as const) {
    const source = port ? inheritProfile(port) : null
    if (source && !ductProfilesMatch(source, profile) && !adapter) {
      return {
        ...invalidPlan(),
        validationMessage: 'Align the connection or draw a 15–90° bend to fit the profile change.',
      }
    }
  }
  const ductStart =
    startAdapter?.collarPoint ??
    startPlan?.collarPoint ??
    teePlan?.branchCollar ??
    startRealign?.collarPoint ??
    start
  let ductEnd =
    endAdapter?.collarPoint ??
    endPlan?.collarPoint ??
    endTeePlan?.branchCollar ??
    endRealign?.collarPoint ??
    end
  const plans = [startPlan, endPlan].filter((p) => p !== null)
  const tee = teePlan
  let endTee = endTeePlan && endTrunkBody?.nodeId === trunkBody?.nodeId ? null : endTeePlan
  if (!endTee && endTeePlan) ductEnd = endRealign?.collarPoint ?? end
  const realigns = [startRealign, endRealign].filter((p) => p !== null)

  const crossHit = surface
    ? findRunBodyCrossingSurface(start, end, BODY_SNAP_RADIUS_M, surface)
    : null
  const crossOwner = crossHit ? useScene.getState().nodes[crossHit.nodeId] : null
  const crossTappedElsewhere =
    crossHit?.nodeId === trunkBody?.nodeId || crossHit?.nodeId === endTrunkBody?.nodeId
  const cross =
    crossHit && !crossTappedElsewhere && crossOwner?.type === 'duct-segment'
      ? planCrossAtRunBody(crossOwner, crossHit, dir, profile)
      : null

  if (
    !hasFittingClearance(ductStart, ductEnd, dir, 0.08) ||
    (trunkBody && !teePlan) ||
    (endTrunkBody && !endTeePlan) ||
    (crossHit && !crossTappedElsewhere && !cross)
  )
    return invalidPlan()
  if (
    cross &&
    (!hasFittingClearance(ductStart, cross.branchCollarNear, dir, 0.08) ||
      !hasFittingClearance(cross.branchCollarFar, ductEnd, dir, 0.08))
  )
    return invalidPlan()

  // Rect / oval continuity: roll the new run's cross-section so its
  // profile stays continuous with whatever either end joined.
  let roll = 0
  if (profile.shape !== 'round') {
    const newDir = new Vector3(...dir)
    roll = continuityRollForRun(startPort, endPort, newDir)
  }

  const defaults = ductSegmentDefinition.defaults()
  const makeDuct = (from: [number, number, number], to: [number, number, number]) =>
    DuctSegmentNode.parse({
      ...defaults,
      ...toolDefaults,
      autoHangers,
      hangerStyle,
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
    ...[startAdapter, endAdapter].flatMap((p) => (p ? [p.fitting] : [])),
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

  return { validationMessage: null, fittings, ducts, tails, updates }
}

const DuctSegmentTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const cursorRef = useRef<Group>(null)
  const continuationSeedRef = useRef(currentDuctContinuationSeed())
  const continuationSeed = continuationSeedRef.current
  const hangerDefaults = useEditor((state) => state.toolDefaults['duct-segment'])
  const autoHangers = Boolean(
    hangerDefaults?.autoHangers ?? continuationSeed?.duct.autoHangers ?? false,
  )
  const setAutoHangers = (enabled: boolean) => {
    const editor = useEditor.getState()
    editor.setToolDefaults('duct-segment', {
      ...editor.toolDefaults['duct-segment'],
      autoHangers: enabled,
    })
  }
  const hangerStyle =
    (hangerDefaults?.hangerStyle ?? continuationSeed?.duct.hangerStyle) === 'double'
      ? 'double'
      : 'single'
  const setHangerStyle = (style: 'single' | 'double') => {
    const editor = useEditor.getState()
    editor.setToolDefaults('duct-segment', {
      ...editor.toolDefaults['duct-segment'],
      hangerStyle: style,
    })
  }
  const hangerStyleRef = useRef<'single' | 'double'>(hangerStyle)
  hangerStyleRef.current = hangerStyle
  const autoHangersRef = useRef(autoHangers)
  autoHangersRef.current = autoHangers
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
  const profileRef = useRef(profile)
  profileRef.current = profile
  const run = useDistributionRunTool({
    active: !!activeLevelId,
    levelId: activeLevelId,
    toolName: 'duct-segment',
    initialStart: continuationSeed
      ? ([...(continuationSeed.port?.position ?? continuationSeed.body?.point ?? [0, 0, 0])] as [
          number,
          number,
          number,
        ])
      : null,
    initialConnection: continuationSeed
      ? { port: continuationSeed.port, body: continuationSeed.body }
      : null,
    findPort: findNearbyPort,
    findBody: (point) =>
      findNearestRunBody3D(point, BODY_SNAP_RADIUS_M, { levelId: activeLevelId ?? undefined }),
    surfaceClearance: (surface) =>
      surface
        ? runSectionHalfSizeM(
            profileRef.current.shape === 'round'
              ? profileRef.current.diameter
              : profileRef.current.height,
          )
        : 0,
    minimumSegmentLength: 0.08,
    inheritFromConnection: ({ port }) => {
      if (!port) return
      const inherited = inheritProfile(port)
      if (inherited) setProfile(inherited)
    },
    commit: ({ start, end, startConnection, endConnection, surfaceTarget }) => {
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
        surfaceTarget,
        autoHangersRef.current,
        undefined,
        hangerStyleRef.current,
      )
      if (!plan || plan.validationMessage) return null
      const attachDuct = (node: DuctSegmentNode): DuctSegmentNode => {
        const wallAttachment =
          surfaceTarget?.kind === 'wall'
            ? createRunWallAttachment(
                surfaceTarget.hostId as Extract<AnyNode['id'], `wall_${string}`>,
                surfaceTarget.side,
                node.path[0]!,
                node.path.at(-1)!,
                surfaceTarget,
                profileRef.current.shape === 'round'
                  ? runSectionHalfSizeM(profileRef.current.diameter)
                  : runSectionHalfSizeM(profileRef.current.height),
              )
            : undefined
        return { ...node, wallAttachment }
      }
      const ducts = plan.ducts.map(attachDuct)
      const tails = plan.tails
      useScene.getState().applyNodeChanges({
        create: [
          ...plan.fittings.map((node) => ({ node, parentId: activeLevelId })),
          ...tails.map((node) => ({ node, parentId: activeLevelId })),
          ...ducts.map((node) => ({ node, parentId: activeLevelId })),
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
    onShortcut: (event) => {
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
          shape: current.shape === 'round' ? 'rect' : current.shape === 'rect' ? 'oval' : 'round',
        }))
        triggerSFX('sfx:grid-snap')
      }
    },
  })

  const previewPlan = useMemo(() => {
    if (!(activeLevelId && run.start && run.cursor)) return null
    return planDuctDraw(
      run.start,
      run.cursor,
      pendingPromotionRef.current ? null : run.startConnection.port,
      run.startConnection.body,
      run.endConnection.port,
      run.endConnection.body,
      profile,
      run.surfaceTarget,
      autoHangers,
      hangerDefaults,
      hangerStyle,
    )
  }, [
    activeLevelId,
    autoHangers,
    hangerDefaults,
    hangerStyle,
    profile,
    run.start,
    run.cursor,
    run.startConnection,
    run.endConnection,
    run.surfaceTarget,
  ])
  const ghostFittings = useMemo(() => previewPlan?.fittings ?? [], [previewPlan])

  useEffect(() => {
    usePathDraftPreview
      .getState()
      .setDraft(
        'duct-segment',
        run.start ? [run.start] : [],
        run.cursor,
        { ...profile, autoHangers, hangerStyle },
        ghostFittings,
      )
  }, [autoHangers, hangerStyle, ghostFittings, profile, run.cursor, run.start])
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
      <ConnectionFeedback
        point={run.cursor}
        target={run.endConnection.port}
        levelId={activeLevelId}
        profile={{
          ...profile,
          system: String(hangerDefaults?.system ?? ductSegmentDefinition.defaults().system),
        }}
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
        cursorRef={cursorRef}
        directionMode={run.directionMode}
        extraParts={extraParts}
        lengthInput={run.lengthInput}
        onLengthInputChange={run.onLengthInputChange}
        onDirectionSelect={run.onDirectionSelect}
        validationMessage={previewPlan?.validationMessage ?? run.validationMessage}
        snapTarget={run.snapTarget}
        start={run.start}
        startDirection={run.startConnection.port?.direction ?? null}
        status={
          <RunHangerToggle
            enabled={autoHangers}
            onChange={setAutoHangers}
            style={hangerStyle}
            onStyleChange={setHangerStyle}
          />
        }
        unit={unit}
      />
      {run.start && (
        <mesh layers={EDITOR_LAYER} position={run.start}>
          <sphereGeometry args={[0.07, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      )}
      {previewPlan?.ducts.map((duct, index) => (
        <DuctSegmentGhost duct={duct} key={index} />
      ))}
      {previewPlan?.ducts.map((duct, index) => (
        <RunHangerPreview key={`hanger-${index}`} run={duct} levelId={activeLevelId} />
      ))}
      {ghostFittings.map((fitting) => (
        <FittingGhost fitting={fitting} key={fitting.id} />
      ))}
    </LevelOffsetGroup>
  )
}

export default DuctSegmentTool
