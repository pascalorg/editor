'use client'

import {
  type AnyNode,
  type AnyNodeId,
  criticallyDamped,
  emitter,
  isRestoringSceneHistory,
  nodeRegistry,
  type RevealPhase,
  type RevealStyle,
  type SceneCommit,
  sceneRegistry,
  subscribeSceneCommits,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { type Box3, type Object3D, Vector3 } from 'three'
import { DustPool, emitAlongBase, emitAroundFoot } from '../../lib/construction-dust'
import {
  type ChangeCandidate,
  type ConstructionRevealLevel,
  commitChangeCandidates,
  commitRevealCandidates,
  nodeRevealCandidates,
  PART_LEAD,
  type StagedCandidate,
} from '../../lib/reveal-candidates'
import { clearGhost, setGhost } from '../../lib/reveal-ghost'
import { isRevealWaiting, revealPending } from '../../lib/reveal-pending'
import {
  clearRevealPose,
  hasRevealPose,
  REVEAL_ARRIVAL,
  type RetractPoseSample,
  type RevealPoseSample,
  retractPoseAt,
  revealHasLanded,
  revealLocalBounds,
  revealPivot,
  revealPoseAt,
  setGlidePose,
  setRevealPose,
} from '../../lib/reveal-pose'
import {
  type PlannedReveal,
  planRetract,
  planReveal,
  REVEAL_TIMING,
  type RevealCandidate,
  revealGroupKey,
} from '../../lib/reveal-schedule'
import useViewer from '../../store/use-viewer'
import { resolveLevelVisibility } from '../level/level-utils'
import { ConstructionDust } from './construction-dust'

/**
 * Construction reveal: what an agent builds appears as a construction, not a
 * pop. The store write is already done and is one undo step; only the
 * presentation is staggered. New nodes of a revealed commit whose kind
 * declares `capabilities.reveal` stay unmounted until their start time — so
 * their geometry builds over frames, not in one — then move into place in
 * their declared style, phase by phase, every floor at once.
 *
 * The host decides which commits reveal (`reveals`) and how much animation
 * plays (`level`); the viewer knows no agent. A reveal ends at once on a load
 * or hydration, an undo, a capture or export, and for selected nodes; it
 * never plays under reduced motion or in a read-only viewer, and never for a
 * level nobody sees.
 */

export type { ConstructionRevealLevel } from '../../lib/reveal-candidates'
export { isRevealWaiting }

type ActiveReveal = {
  id: string
  candidate: RevealCandidate
  style: RevealStyle
  height: number
  levelId: string | null
  startedAt: number
  durationMs: number
  clockStart: number | null
  pivot: Vector3 | null
  base: Box3 | null
  landed: boolean
  root: Object3D | null
  /** A drop's anticipation, and how heavy it lands: the last piece of a build is heavier. */
  lead: number
  weight: number
  /** The last piece of the plan to arrive; the reveal says when it has. */
  finale: boolean
  finaleSaid: boolean
}

export type RevealPhaseEvent = { phase: RevealPhase; levelId: string | null }

/**
 * What a reveal says about one (phase, level) group of nodes, on the reveal's own clock:
 * - `start`: its first node begins;
 * - `land`: its first node makes contact, the frame a sound belongs on (a drop's impact);
 * - `settle`: its last node is at rest.
 * `instant` is true when the host showed the build at once (animation off, reduced motion, a
 * level nobody sees) or the reveal was cut short: the three come together, in that order.
 */
export type RevealGroupEvent = {
  type: 'start' | 'land' | 'settle'
  phase: RevealPhase
  levelId: string | null
  /** Every node the group stages (those still to come from a later commit are not in it). */
  nodeIds: readonly string[]
  /** Who wrote the build, as the host named it on the commit. */
  source: string | null
  instant: boolean
  atMs: number
  /** The agent moved what was already there: the group is its pieces, not a build. */
  changed?: true
}

/** One node begins to move in. */
export type RevealNodeStartEvent = {
  type: 'node-start'
  id: string
  phase: RevealPhase
  levelId: string | null
  /** `glide` is a piece moving from one place to another (`changed`). */
  style: RevealStyle | 'glide'
  source: string | null
  atMs: number
  /** The agent moved this piece; it was already there. */
  changed?: true
}

/**
 * The last piece of a build has arrived (a drop's impact): the moment the build is finished,
 * which a recap and a success sound answer. A build shown at once has none.
 */
export type RevealFinaleEvent = {
  type: 'finale'
  id: string
  phase: RevealPhase
  levelId: string | null
  source: string | null
  atMs: number
}

/** Nothing is left to reveal: the last node is at rest. */
export type RevealCompleteEvent = {
  type: 'complete'
  nodeCount: number
  /** From the first node staged to the last at rest. */
  durationMs: number
  source: string | null
  instant: boolean
  atMs: number
  /** What finished was the agent moving what was already there, not a build. */
  changed?: true
}

/**
 * The build played in reverse (an undo, `retractNodes`), one (phase, level) group at a time, the last
 * phase built first:
 * - `retract-start`: its first node begins to go;
 * - `retract-end`: its last node is gone (hidden, and held so until the host takes it out of the scene).
 */
export type RevealRetractEvent = {
  type: 'retract-start' | 'retract-end'
  phase: RevealPhase
  levelId: string | null
  nodeIds: readonly string[]
  source: string | null
  atMs: number
}

export type RevealEvent =
  | RevealGroupEvent
  | RevealNodeStartEvent
  | RevealFinaleEvent
  | RevealCompleteEvent
  | RevealRetractEvent

/** What `retractNodes` reports once what it could show going has gone. */
export type RetractResult = {
  /** Every node taken back: those asked for, and what stands under them. */
  retracted: string[]
  /** Those asked for that were not shown going: not in the scene, not mounted, or already going. */
  skipped: string[]
  /** Nothing animated: the animation is off, motion is reduced, or no reveal runs. The host goes on at once. */
  instant: boolean
}

/** A node's reveal as a plan view draws it: its style and how far it has come, 0 → 1. */
export type RevealPlanState = { style: RevealStyle; progress: number }

/** A started node waits this long for its renderer to register (its kind may never mount). */
const MOUNT_TIMEOUT_MS = 2000
/**
 * And this long for its first build (an item's model) before it animates anyway, counted from
 * the last build that landed: a wall builds once mounted, a few a frame, so a big agent build
 * queues for longer than this while every build lands in turn (Victor run 11: 1,545 walls).
 */
const BUILD_TIMEOUT_MS = 2500
/** The longest step the reveal clock takes: a stalled tab resumes the build, it does not start it all at once. */
const MAX_STEP_MS = 50
const MIN_SCALE = 1e-3
/** A full-height drop (a column from 4 m) raises the most dust. */
const FULL_DUST_DROP_M = 4
/** The last piece of a build lands this much heavier: a bigger squash, a bigger puff. */
const FINALE_WEIGHT = 1.7
/** A lifted node rises over this many seconds, and comes back a little quicker. */
const LIFT_RESPONSE_UP_S = 0.55
const LIFT_RESPONSE_DOWN_S = 0.45
/**
 * It waits this long after the last piece of the phase has landed, in case more is coming: one
 * furnishing is often several writes, a model's turn between them takes seconds, and a roof that
 * bobs down and up between them is a distraction. A host that knows the turn is over brings it down
 * at once (`seatLiftedNow`).
 */
const LIFT_HOLD_MS = 10_000
/** The beat the room is seen whole under the open sky before the roof comes down on a host's say. */
const LIFT_BEAT_MS = 700
/** At the top it is this faint (a ghost), never gone: the walls under it keep their shape. */
const LIFT_GHOST_MIN = 0.14
/**
 * A ghost's first draw (the transparent variant of every roof material) costs its shaders: a lift warms
 * with the roof at this opacity, indistinguishable from whole, before it begins to rise.
 */
const LIFT_WARM_OPACITY = 0.995
/** A lift stays put this many quiet frames after its first ghost draw. */
const LIFT_WARM_TICKS = 3
/**
 * A kind's first appearance costs its shaders and pipelines (a first wall, a roof, an item's model are
 * 100 to 400 ms), and the frame that pays freezes the picture. So the first node of each kind not yet
 * on screen mounts up front, hidden, and the plan waits for it to have drawn and for the frames to be
 * quiet again: the stall lands while nothing moves.
 */
const WARM_QUIET_FRAMES = 2
const WARM_QUIET_FRAME_MS = 34
const WARM_MIN_TICKS = 2
const WARM_MAX_MS = 2500
/** A node whose renderer has not registered a root by then never will (a kind with no 3D renderer). */
const WARM_MOUNT_MS = 600
const UNIT = new Vector3(1, 1, 1)
const ORIGIN = new Vector3()
const HIDDEN = new Vector3(MIN_SCALE, MIN_SCALE, MIN_SCALE)
const sample: RevealPoseSample = { lift: 0, scale: new Vector3() }
const lineFrom = new Vector3()
const lineTo = new Vector3()
const foot = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]

const pending = revealPending
let queue: PlannedReveal[] = []
let unplanned = false
/** The plan is to be made again, once what mounts up front has drawn. */
let replanning = false
type Warming = { culled: Map<Object3D, boolean>; builtTicks: number }
const warming = new Map<string, Warming>()
/** Roofs ghosted ahead of the furniture, with the frames they have drawn so. */
const ghostWarming = new Map<string, number>()
let warmWaiting = false
let warmStartedMs = 0
let warmQuiet = 0
let dustWarmed = false
/** Whether the last frame took no longer than a steady one (unknown: it did not). */
let frameQuiet = true
const active = new Map<string, ActiveReveal>()
const announced = new Set<string>()
/** An assembled node's parts still on their way, and each part's host. */
const parts = new Map<string, Set<string>>()
const hostOf = new Map<string, string>()
let arrivals = 0
let lastStartMs = Number.NEGATIVE_INFINITY
let clockMs = 0
/** When a started node's first build last landed. */
let buildLandedMs = Number.NEGATIVE_INFINITY
let tickedBusy = false
let revealLevel: () => ConstructionRevealLevel = () => 'full'
let dust: DustPool | null = null

type RevealGroup = {
  phase: RevealPhase
  levelId: string | null
  ids: Set<string>
  remaining: number
  started: boolean
  /** What lifts out of the way of its phase has been asked to. */
  lifted: boolean
  landed: boolean
  /** Some node of it moved: it did not only appear. */
  animated: boolean
  /** Cut short (a load, an undo, a capture): it settles at once. */
  forced: boolean
  source: string | null
}

/** The groups still open, each (phase, level) once; and the group each staged node counts in. */
const groups = new Map<string, RevealGroup>()
const groupOfNode = new Map<string, string>()
// ---------------------------------------------------------------------------------------------
// Changes. An agent moves what is already there: the piece shows where it was and glides to where
// it is, a few at a time, said in the words of a build with `changed` on them.
// ---------------------------------------------------------------------------------------------

type ChangeGroup = {
  phase: RevealPhase
  levelId: string | null
  ids: Set<string>
  remaining: number
  started: boolean
  landed: boolean
  animated: boolean
  forced: boolean
  source: string | null
}
type Glide = {
  change: ChangeCandidate
  startAt: number
  state: { x: number; v: number }
  began: boolean
}

/** Moves waiting for the reveal to be quiet: they hold at their old place meanwhile. */
let changeQueue: ChangeCandidate[] = []
/** The ids waiting in `changeQueue`. */
const queuedChanges = new Set<string>()
/** Pieces on their way (or waiting their turn to start). */
const glides = new Map<string, Glide>()
const changeGroups = new Map<string, ChangeGroup>()
const changeGroupOf = new Map<string, string>()
/** The moves since the reveal was last quiet: what a change's `complete` reports. */
let changeRun: {
  startedAt: number
  count: number
  source: string | null
  animated: boolean
} | null = null
let glideClockMs = Number.NEGATIVE_INFINITY
/** A move lifted the roof for the furniture: it is let go of at this time on the clock, a beat after the last. */
let changeLiftReleaseAt: number | null = null
/** How long after the last move the roof is let go of (it then waits out `LIFT_HOLD_MS` for more). */
const CHANGE_LIFT_BEAT_MS = 1200
/** A glide is a short spring: it is home about three quarters of a second after it starts. */
const GLIDE_RESPONSE_S = 0.7
/** A piece is carried, not slid: it rises this far (metres) half way. */
const GLIDE_HOP_M = 0.05
/** Pieces of a rearranged room start this far apart, up to a cap however many move. */
const GLIDE_STAGGER_MS = 80
const GLIDE_STAGGER_CAP_MS = 1200

/** The build since the reveal was last idle: what `complete` reports. */
let build: { startedAt: number; count: number; source: string | null; animated: boolean } | null =
  null

/** A node that lifts out of the way of a phase while it plays (a roof over the furniture). */
type Lift = {
  id: string
  phase: RevealPhase
  levelId: string | null
  height: number
  state: { x: number; v: number }
  target: 0 | 1
  /** When it comes back down; null while the phase it makes room for is still playing. */
  releaseAt: number | null
  root: Object3D | null
  /** Quiet frames it still holds at the ghost's first draw before it rises. */
  warm: number
}

/** What is up, and what has asked to be but is still being built or revealed. */
const lifts = new Map<string, Lift>()
const liftWanted = new Map<string, { phase: RevealPhase; levelId: string | null; height: number }>()
/** The build's finale, said when what was lifted seats again instead of at the last landing. */
let deferredFinale: Omit<RevealFinaleEvent, 'atMs' | 'id'> | null = null
let liftClockMs = Number.NEGATIVE_INFINITY

const pendingListeners = new Map<string, Set<() => void>>()
const phaseListeners = new Set<(event: RevealPhaseEvent) => void>()
const eventListeners = new Set<(event: RevealEvent) => void>()
const assemblyListeners = new Map<string, Set<(assembling: boolean) => void>>()
const tickListeners = new Set<() => void>()

function notifyPending(id: string) {
  const listeners = pendingListeners.get(id)
  if (listeners) for (const listener of [...listeners]) listener()
}

function notifyAssembly(hostId: string, assembling: boolean) {
  const listeners = assemblyListeners.get(hostId)
  if (listeners) for (const listener of [...listeners]) listener(assembling)
}

function notifyTicks() {
  for (const listener of [...tickListeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[viewer] reveal tick listener failed', error)
    }
  }
}

/**
 * Whether the node waits for its turn (unmounted), is still moving in, is going out (a reverse play,
 * and held gone until the host takes it out of the scene), or is being carried to a new place. A batch
 * hands it back to itself and keeps it out.
 */
export function isNodeRevealing(id: string): boolean {
  return (
    pending.has(id) ||
    active.has(id) ||
    retracts.has(id) ||
    held.has(id) ||
    glides.has(id) ||
    queuedChanges.has(id)
  )
}

/**
 * A `cut` node leaves its host: the host, built whole while it waited, rebuilds with the opening.
 */
function released(candidate: RevealCandidate) {
  notifyPending(candidate.id)
  if (candidate.style !== 'cut') return
  const hostId = useScene.getState().nodes[candidate.id as AnyNodeId]?.parentId as AnyNodeId | null
  if (hostId) useScene.getState().markDirty(hostId)
}

function subscribePending(id: string, listener: () => void): () => void {
  let listeners = pendingListeners.get(id)
  if (!listeners) {
    listeners = new Set()
    pendingListeners.set(id, listeners)
  }
  const own = listeners
  own.add(listener)
  return () => {
    own.delete(listener)
    if (own.size === 0 && pendingListeners.get(id) === own) pendingListeners.delete(id)
  }
}

/**
 * True while the node waits for its turn: its renderer stays unmounted. A node that mounts up front,
 * hidden, to draw its shaders before the build moves (see `chooseWarm`) is mounted: not pending.
 */
export function useRevealPending(id: string): boolean {
  const subscribe = useCallback((listener: () => void) => subscribePending(id, listener), [id])
  const read = useCallback(() => pending.has(id) && !warming.has(id), [id])
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * True while the plan has something to play for the node: it waits for its turn, moves in, goes (an
 * undo's reverse play) or is held gone. A plan entry that draws the node itself subscribes to the
 * reveal's ticks only while this is true.
 */
export function useRevealPlanActive(id: string): boolean {
  const subscribe = useCallback((listener: () => void) => subscribePending(id, listener), [id])
  const read = useCallback(
    () => pending.has(id) || active.has(id) || retracts.has(id) || held.has(id),
    [id],
  )
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * True while the node has not had its turn, mounted up front or not: what a view that draws the node
 * itself (the 2D plan) leaves out until it does.
 */
export function useRevealWaiting(id: string): boolean {
  const subscribe = useCallback((listener: () => void) => subscribePending(id, listener), [id])
  const read = useCallback(() => pending.has(id), [id])
  return useSyncExternalStore(subscribe, read, read)
}

/** True while an `assemble` node's parts are still on their way: its renderer draws them apart. */
export function isRevealAssembling(id: string): boolean {
  return (parts.get(id)?.size ?? 0) > 0
}

/**
 * Calls `listener` each time `id` starts or stops assembling. It fires
 * synchronously, even when a capture ends the reveal, so a renderer that
 * swaps its parts for a merged shell can do so before the frame is cloned.
 */
export function subscribeRevealAssembling(
  id: string,
  listener: (assembling: boolean) => void,
): () => void {
  let listeners = assemblyListeners.get(id)
  if (!listeners) {
    listeners = new Set()
    assemblyListeners.set(id, listeners)
  }
  const own = listeners
  own.add(listener)
  return () => {
    own.delete(listener)
    if (own.size === 0 && assemblyListeners.get(id) === own) assemblyListeners.delete(id)
  }
}

/**
 * The node's reveal for a plan view, on the reveal's own clock: `progress` is
 * 0 while it waits and runs to 1 over its style's duration from its start
 * (not from its first 3D build, which a paused canvas never runs). Null once
 * it is done, or if it never revealed.
 */
export function getRevealPlanState(id: string): RevealPlanState | null {
  const waiting = pending.get(id)
  if (waiting) return { style: waiting.style, progress: 0 }
  // The build played in reverse is the same state read backwards: whole until its turn, then going,
  // then gone while it is held.
  const retract = retracts.get(id)
  if (retract) {
    if (clockMs < retract.startMs) return null
    const gone = (clockMs - retract.startMs) / Math.max(1, retract.durationMs)
    return { style: retract.style, progress: Math.min(1, Math.max(0, 1 - gone)) }
  }
  const gone = held.get(id)
  if (gone) return { style: gone.style, progress: 0 }
  const reveal = active.get(id)
  if (!reveal) return null
  const durationMs = reveal.style === 'assemble' ? REVEAL_TIMING.durationMs.drop : reveal.durationMs
  const progress = (clockMs - reveal.startedAt) / Math.max(1, durationMs)
  return { style: reveal.style, progress: Math.min(1, Math.max(0, progress)) }
}

/** Calls `listener` after every reveal step while anything reveals, and once when it all ends. */
export function subscribeRevealTicks(listener: () => void): () => void {
  tickListeners.add(listener)
  return () => {
    tickListeners.delete(listener)
  }
}

/**
 * Everything a reveal says, in order and on its clock: the phase groups starting, landing and
 * settling, each node starting, and the build completing. The chat's step cards, the sounds and the
 * camera that follows the build listen here, so they share one rhythm.
 */
export function subscribeRevealEvents(listener: (event: RevealEvent) => void): () => void {
  eventListeners.add(listener)
  return () => {
    eventListeners.delete(listener)
  }
}

function emit(event: RevealEvent) {
  for (const listener of [...eventListeners]) {
    try {
      listener(event)
    } catch (error) {
      console.error('[viewer] reveal event listener failed', error)
    }
  }
}

function emitGroup(type: RevealGroupEvent['type'], group: RevealGroup, atMs: number) {
  emit({
    type,
    phase: group.phase,
    levelId: group.levelId,
    nodeIds: [...group.ids],
    source: group.source,
    instant: !group.animated || group.forced,
    atMs,
  })
}

/** Counts each staged node in its (phase, level) group, and the build they belong to. */
function registerCandidates(candidates: readonly RevealCandidate[], atMs: number) {
  build ??= { startedAt: atMs, count: 0, source: null, animated: false }
  for (const candidate of candidates) {
    const key = revealGroupKey(candidate)
    let group = groups.get(key)
    if (!group) {
      group = {
        phase: candidate.phase,
        levelId: candidate.levelId,
        ids: new Set(),
        remaining: 0,
        started: false,
        lifted: false,
        landed: false,
        animated: false,
        forced: false,
        source: candidate.source ?? null,
      }
      groups.set(key, group)
    }
    if (!group.ids.has(candidate.id)) group.remaining += 1
    group.ids.add(candidate.id)
    groupOfNode.set(candidate.id, key)
    build.count += 1
    build.source = candidate.source ?? build.source
  }
}

/**
 * A node is let in to play. What lifts out of the way of its phase starts to, so the roof is on its way
 * as the first piece of furniture begins; the group itself is not said to have started until a node moves.
 */
function groupReleased(candidate: RevealCandidate) {
  const group = groups.get(revealGroupKey(candidate))
  if (!group) return
  group.animated = true
  if (build) build.animated = true
  if (!group.lifted) {
    group.lifted = true
    wantLifts(group.phase, group.levelId)
  }
}

/**
 * A node's first move: a group's first node begins to move. That is when a step card lands and the
 * camera goes there, not when the node is let in (it may wait for a slow build, and nothing is seen).
 */
function groupStarted(candidate: RevealCandidate, atMs: number) {
  const group = groups.get(revealGroupKey(candidate))
  if (!group) return
  if (!group.started) {
    group.started = true
    emitGroup('start', group, atMs)
  }
  emit({
    type: 'node-start',
    id: candidate.id,
    phase: candidate.phase,
    levelId: candidate.levelId,
    style: candidate.style,
    source: candidate.source ?? null,
    atMs,
  })
}

/** A group's first node makes contact: the frame its sound belongs on. */
function groupLanded(id: string, atMs: number) {
  const group = groups.get(groupOfNode.get(id) ?? '')
  if (!group || group.landed) return
  if (!group.started) {
    group.started = true
    emitGroup('start', group, atMs)
  }
  group.landed = true
  emitGroup('land', group, atMs)
}

/**
 * `id` is at rest (or was never staged, or was cut short): when its group has no node left, the
 * group settles, saying the start and the land first if it never had occasion to.
 */
function closeNode(id: string, atMs: number, forced: boolean) {
  const key = groupOfNode.get(id)
  if (key === undefined) return
  groupOfNode.delete(id)
  const group = groups.get(key)
  if (!group) return
  if (forced) group.forced = true
  group.remaining -= 1
  if (group.remaining > 0) return
  groups.delete(key)
  if (!group.started) {
    group.started = true
    emitGroup('start', group, atMs)
  }
  if (!group.landed) {
    group.landed = true
    emitGroup('land', group, atMs)
  }
  emitGroup('settle', group, atMs)
  releaseLifts(group.phase, atMs)
}

/** The build is over: nothing waits and nothing moves. */
function completeBuild(atMs: number, forced: boolean) {
  const finished = build
  build = null
  if (!finished) return
  emit({
    type: 'complete',
    nodeCount: finished.count,
    durationMs: Math.max(0, atMs - finished.startedAt),
    source: finished.source,
    instant: forced || !finished.animated,
    atMs,
  })
}

function emitChangeGroup(type: RevealGroupEvent['type'], group: ChangeGroup, atMs: number) {
  emit({
    type,
    phase: group.phase,
    levelId: group.levelId,
    nodeIds: [...group.ids],
    source: group.source,
    instant: !group.animated || group.forced,
    atMs,
    changed: true,
  })
}

/** Counts each moved piece in its (phase, level) group, and the run they belong to. */
function registerChanges(changes: readonly ChangeCandidate[], atMs: number) {
  changeRun ??= { startedAt: atMs, count: 0, source: null, animated: false }
  for (const change of changes) {
    const key = revealGroupKey(change)
    let group = changeGroups.get(key)
    if (!group) {
      group = {
        phase: change.phase,
        levelId: change.levelId,
        ids: new Set(),
        remaining: 0,
        started: false,
        landed: false,
        animated: false,
        forced: false,
        source: change.source ?? null,
      }
      changeGroups.set(key, group)
    }
    if (!group.ids.has(change.id)) group.remaining += 1
    group.ids.add(change.id)
    changeGroupOf.set(change.id, key)
    changeRun.count += 1
    changeRun.source = change.source ?? changeRun.source
  }
}

/** A piece's move begins: its group starts with its first, and the roof lifts out of the way as for furniture. */
function beginChange(change: ChangeCandidate, atMs: number) {
  const group = changeGroups.get(changeGroupOf.get(change.id) ?? '')
  if (!group) return
  if (!group.started) {
    group.started = true
    emitChangeGroup('start', group, atMs)
  }
  emit({
    type: 'node-start',
    id: change.id,
    phase: change.phase,
    levelId: change.levelId,
    style: 'glide',
    source: change.source ?? null,
    atMs,
    changed: true,
  })
  wantLifts(change.phase, change.levelId)
  changeLiftReleaseAt = null
}

/** A piece is home (or its move was cut short): its group settles with its last, and the run with its last group. */
function endChange(id: string, atMs: number, forced: boolean) {
  const key = changeGroupOf.get(id)
  if (key === undefined) return
  changeGroupOf.delete(id)
  const group = changeGroups.get(key)
  if (!group) return
  if (forced) group.forced = true
  if (!group.started) {
    group.started = true
    emitChangeGroup('start', group, atMs)
  }
  if (!group.landed) {
    group.landed = true
    emitChangeGroup('land', group, atMs)
  }
  group.remaining -= 1
  if (group.remaining > 0) return
  changeGroups.delete(key)
  emitChangeGroup('settle', group, atMs)
  if (changeGroups.size > 0) return
  const run = changeRun
  changeRun = null
  if (!run) return
  emit({
    type: 'complete',
    nodeCount: run.count,
    durationMs: Math.max(0, atMs - run.startedAt),
    source: run.source,
    instant: forced || !run.animated,
    atMs,
    changed: true,
  })
  changeLiftReleaseAt = atMs + CHANGE_LIFT_BEAT_MS
}

const glideFrom = new Vector3()

/** Shows `change` where it was, with `left` of the way still to go. */
function poseGlide(change: ChangeCandidate, root: Object3D, left: number) {
  const from = change.from
  if (!from) return
  glideFrom.set(...from.position)
  setGlidePose(root, glideFrom, from.yaw, left, GLIDE_HOP_M * 4 * left * (1 - left))
}

/** Whether a move glides now: it has somewhere to glide from, and the animation plays. */
function glidePlays(change: ChangeCandidate): boolean {
  return change.from !== null && !showsAtOnce() && !useViewer.getState().renderPaused
}

/** The agent's moves wait for the reveal to be quiet; until then each piece holds at its old place. */
function queueChanges(changes: readonly ChangeCandidate[]) {
  for (const change of changes) {
    if (queuedChanges.has(change.id) || glides.has(change.id)) continue
    queuedChanges.add(change.id)
    changeQueue.push(change)
    const root = sceneRegistry.nodes.get(change.id)
    if (root && glidePlays(change)) poseGlide(change, root, 1)
  }
}

/** Takes the glide pose off a piece that will not glide (it has gone, or the animation has been turned off). */
function dropGlidePose(id: string) {
  const root = sceneRegistry.nodes.get(id)
  if (root && hasRevealPose(root)) clearRevealPose(root)
}

/** The reveal is quiet: the queued moves begin, a beat apart, or are said at once where they cannot glide. */
function flushChanges(now: number) {
  const nodes = useScene.getState().nodes
  const waiting = changeQueue.filter((change) => nodes[change.id as AnyNodeId])
  for (const change of changeQueue) if (!nodes[change.id as AnyNodeId]) dropGlidePose(change.id)
  changeQueue = []
  queuedChanges.clear()
  if (waiting.length === 0) return
  registerChanges(waiting, now)
  const atOnce: ChangeCandidate[] = []
  let delay = 0
  for (const change of waiting) {
    const root = sceneRegistry.nodes.get(change.id)
    if (root && glidePlays(change)) {
      poseGlide(change, root, 1)
      glides.set(change.id, {
        change,
        startAt: now + Math.min(delay, GLIDE_STAGGER_CAP_MS),
        state: { x: 1, v: 0 },
        began: false,
      })
      delay += GLIDE_STAGGER_MS
      const group = changeGroups.get(changeGroupOf.get(change.id) ?? '')
      if (group) group.animated = true
      if (changeRun) changeRun.animated = true
    } else {
      dropGlidePose(change.id)
      atOnce.push(change)
    }
  }
  for (const change of atOnce) beginChange(change, now)
  for (const change of atOnce) endChange(change.id, now, false)
}

function stepGlides(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - glideClockMs) / 1000))
  glideClockMs = now
  const nodes = useScene.getState().nodes
  for (const glide of [...glides.values()]) {
    const { change } = glide
    const root = sceneRegistry.nodes.get(change.id)
    if (!nodes[change.id as AnyNodeId]) {
      glides.delete(change.id)
      endChange(change.id, now, true)
      continue
    }
    if (!glide.began) {
      if (now < glide.startAt) {
        if (root) poseGlide(change, root, 1)
        continue
      }
      glide.began = true
      beginChange(change, now)
    }
    criticallyDamped(glide.state, 0, GLIDE_RESPONSE_S, dt)
    const left = Math.max(0, glide.state.x)
    if (left < 0.003 && Math.abs(glide.state.v) < 0.05) {
      glides.delete(change.id)
      dropGlidePose(change.id)
      endChange(change.id, now, false)
      continue
    }
    if (root) poseGlide(change, root, left)
  }
}

/** A glide is cut short (selected, retracted, the reveal stopped): the piece is home at once. */
function finishGlide(id: string) {
  if (queuedChanges.delete(id)) {
    changeQueue = changeQueue.filter((change) => change.id !== id)
    dropGlidePose(id)
    return
  }
  if (!glides.delete(id)) return
  dropGlidePose(id)
  endChange(id, clockMs, true)
}

function finishChanges() {
  for (const id of [...queuedChanges]) finishGlide(id)
  for (const id of [...glides.keys()]) finishGlide(id)
  changeLiftReleaseAt = null
}

/** One event when each (phase, level) group of a reveal starts — at most one sound cue each. */
export function subscribeRevealPhases(listener: (event: RevealPhaseEvent) => void): () => void {
  phaseListeners.add(listener)
  return () => {
    phaseListeners.delete(listener)
  }
}

function announce(candidate: RevealCandidate) {
  const group = revealGroupKey(candidate)
  if (announced.has(group)) return
  announced.add(group)
  const event: RevealPhaseEvent = { phase: candidate.phase, levelId: candidate.levelId }
  for (const listener of [...phaseListeners]) {
    try {
      listener(event)
    } catch (error) {
      console.error('[viewer] reveal phase listener failed', error)
    }
  }
}

/** What the commit stages, and the parts it adds to a node still assembling from an earlier one. */
function revealCandidates(commit: SceneCommit, at: ConstructionRevealLevel): StagedCandidate[] {
  const candidates = commitRevealCandidates(commit, at, arrivals)
  arrivals += candidates.length
  const { before, current } = commit
  for (const id in current.nodes) {
    if (before.nodes[id as AnyNodeId]) continue
    const node = current.nodes[id as AnyNodeId]
    if (!node || nodeRegistry.get(node.type)?.capabilities?.reveal) continue
    const hostId = node.parentId as string | null
    const host = hostId ? (pending.get(hostId) ?? active.get(hostId)?.candidate) : undefined
    if (host?.style === 'assemble') {
      candidates.push({
        ...host,
        id,
        style: 'drop',
        depth: host.depth + 1,
        seq: arrivals++,
        host: host.id,
        lead: PART_LEAD,
      })
    }
  }
  return candidates
}

function levelShown(levelId: string | null): boolean {
  if (!levelId) return true
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return true
  const viewer = useViewer.getState()
  const selectedId = viewer.selection.levelId
  const selected = selectedId ? nodes[selectedId as AnyNodeId] : undefined
  const { visible, shadowOnly } = resolveLevelVisibility({
    levelMode: viewer.levelMode,
    hideAbove: viewer.hideLevelsAboveSelection,
    hasSelectedLevel: Boolean(selectedId),
    isSelected: level.id === selectedId,
    index: level.level,
    selectedIndex: selected?.type === 'level' ? selected.level : undefined,
    nodeVisible: level.visible !== false,
  })
  return visible && !shadowOnly
}

function endReveal(reveal: ActiveReveal, forced = false) {
  if (reveal.root) clearRevealPose(reveal.root)
  active.delete(reveal.id)
  settle(reveal.id)
  closeNode(reveal.id, clockMs, forced)
}

/** `id` no longer reveals: its host may now be whole, and done. */
function settle(id: string) {
  const hostId = hostOf.get(id)
  if (hostId === undefined) return
  hostOf.delete(id)
  const own = parts.get(hostId)
  if (!own?.delete(id) || own.size > 0) return
  parts.delete(hostId)
  const host = active.get(hostId)
  if (host) endReveal(host)
  notifyAssembly(hostId, false)
}

function startReveal(candidate: RevealCandidate, now: number, animate: boolean) {
  if (!pending.delete(candidate.id)) return
  // A node shows only inside its host: a host still waiting starts with it.
  const nodes = useScene.getState().nodes
  let parentId = nodes[candidate.id as AnyNodeId]?.parentId as AnyNodeId | null | undefined
  for (let guard = 0; parentId && guard < 32; guard += 1) {
    const host = pending.get(parentId)
    if (host) startReveal(host, now, animate)
    parentId = nodes[parentId]?.parentId as AnyNodeId | null | undefined
  }
  released(candidate)
  const wasWarm = restoreWarm(candidate.id)
  if (wasWarm && !(animate && candidate.style !== 'assemble')) {
    // Shown at once, or held still while its parts drop in: neither sets the pose the warm start left.
    const root = sceneRegistry.nodes.get(candidate.id)
    if (root) clearRevealPose(root)
  }
  if (!animate) {
    settle(candidate.id)
    return closeNode(candidate.id, now, false)
  }
  lastStartMs = now
  announce(candidate)
  groupReleased(candidate)
  active.set(candidate.id, {
    id: candidate.id,
    candidate,
    style: candidate.style,
    height: candidate.height,
    levelId: candidate.levelId,
    startedAt: now,
    durationMs: REVEAL_TIMING.durationMs[candidate.style],
    clockStart: null,
    pivot: null,
    base: null,
    landed: false,
    root: null,
    lead: candidate.lead ?? 0,
    weight: 'finale' in candidate && candidate.finale ? FINALE_WEIGHT : 1,
    finale: 'finale' in candidate && candidate.finale === true,
    finaleSaid: false,
  })
}

const dustOn = () => dust !== null && revealLevel() !== 'simple'

/** A rising wall's puff, along the longer side of its base. */
function puffAlongBase(reveal: ActiveReveal, root: Object3D, now: number) {
  const box = reveal.base
  if (!(dust && dustOn() && box) || box.isEmpty()) return
  const midX = (box.min.x + box.max.x) / 2
  const midZ = (box.min.z + box.max.z) / 2
  if (box.max.x - box.min.x >= box.max.z - box.min.z) {
    lineFrom.set(box.min.x, box.min.y, midZ)
    lineTo.set(box.max.x, box.min.y, midZ)
  } else {
    lineFrom.set(midX, box.min.y, box.min.z)
    lineTo.set(midX, box.min.y, box.max.z)
  }
  root.updateWorldMatrix(true, false)
  emitAlongBase(
    dust,
    lineFrom.applyMatrix4(root.matrixWorld),
    lineTo.applyMatrix4(root.matrixWorld),
    now,
  )
}

/** A landing's puff, around its foot. */
function puffAroundFoot(reveal: ActiveReveal, root: Object3D, now: number) {
  const box = reveal.base
  if (!(dust && dustOn() && box) || box.isEmpty()) return
  root.updateWorldMatrix(true, false)
  foot[0]!.set(box.min.x, box.min.y, box.min.z).applyMatrix4(root.matrixWorld)
  foot[1]!.set(box.max.x, box.min.y, box.min.z).applyMatrix4(root.matrixWorld)
  foot[2]!.set(box.max.x, box.min.y, box.max.z).applyMatrix4(root.matrixWorld)
  foot[3]!.set(box.min.x, box.min.y, box.max.z).applyMatrix4(root.matrixWorld)
  const strength = Math.min(1, Math.max(0.25, reveal.height / FULL_DUST_DROP_M)) * reveal.weight
  emitAroundFoot(dust, foot, strength, now)
}

function stepReveal(reveal: ActiveReveal, now: number) {
  const { nodes, dirtyNodes } = useScene.getState()
  if (!nodes[reveal.id as AnyNodeId] || !levelShown(reveal.levelId)) return endReveal(reveal)
  const root = sceneRegistry.nodes.get(reveal.id)
  if (!root) {
    if (now - reveal.startedAt > MOUNT_TIMEOUT_MS) endReveal(reveal)
    return
  }
  if (reveal.root !== root) {
    if (reveal.root) clearRevealPose(reveal.root)
    reveal.root = root
  }
  // An assembled node holds still; it is done once its last part has landed.
  if (reveal.style === 'assemble') {
    if (!isRevealAssembling(reveal.id)) endReveal(reveal)
    return
  }
  if (reveal.clockStart === null) {
    // Hidden until its first build lands, so it moves in from nothing rather
    // than popping in at full size mid-animation.
    if (dirtyNodes.has(reveal.id as AnyNodeId)) {
      if (now - Math.max(reveal.startedAt, buildLandedMs) < BUILD_TIMEOUT_MS) {
        setRevealPose(root, ORIGIN, HIDDEN)
        return
      }
    } else buildLandedMs = now
    reveal.clockStart = now
    reveal.base = revealLocalBounds(root)
    reveal.pivot = revealPivot(reveal.base, reveal.style)
    revealPoseAt(reveal.style, 0, reveal.height, sample, reveal)
    setRevealPose(root, reveal.pivot, sample.scale, sample.lift)
    groupStarted(reveal.candidate, now)
    if (reveal.style === 'rise') puffAlongBase(reveal, root, now)
  }
  const t = (now - reveal.clockStart) / reveal.durationMs
  if (t < 1) {
    revealPoseAt(reveal.style, t, reveal.height, sample, reveal)
    setRevealPose(root, reveal.pivot ?? ORIGIN, sample.scale, sample.lift)
  }
  if (!reveal.landed && revealHasLanded(reveal.style, t)) {
    reveal.landed = true
    groupLanded(reveal.id, now)
    if (reveal.finale && !reveal.finaleSaid && t >= REVEAL_ARRIVAL[reveal.style])
      sayFinale(reveal, now)
    if (reveal.style === 'drop') puffAroundFoot(reveal, root, now)
  }
  if (reveal.finale && !reveal.finaleSaid && t >= REVEAL_ARRIVAL[reveal.style])
    sayFinale(reveal, now)
  if (t >= 1) endReveal(reveal)
}

const climbToBuilding = (id: string): string | null => {
  const nodes = useScene.getState().nodes
  let node = nodes[id as AnyNodeId]
  for (let guard = 0; node && guard < 32; guard += 1) {
    if (node.type === 'building') return node.id
    node = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  }
  return null
}

/** Whether lifts play at the person's level: the full construction only. */
const liftsPlay = () => revealLevel() === 'full' || revealLevel() === 'framing'

/**
 * A phase starts: what declares it clears for it (a roof, for the furnishing) in the same building
 * asks to lift. It lifts as soon as it is built and done revealing.
 */
function wantLifts(phase: RevealPhase, levelId: string | null, skip?: ReadonlySet<string>) {
  if (!liftsPlay()) return
  const nodes = useScene.getState().nodes
  const building = levelId ? climbToBuilding(levelId) : null
  for (const id in nodes) {
    if (skip?.has(id)) continue
    const node = nodes[id as AnyNodeId]
    const clears = node && nodeRegistry.get(node.type)?.capabilities?.reveal?.clears
    if (!clears || clears.for !== phase) continue
    if (building && climbToBuilding(id) !== building) continue
    const held = lifts.get(id)
    if (held) {
      // More of the phase is coming: it stays where it is.
      held.releaseAt = null
      held.target = 1
      continue
    }
    liftWanted.set(id, { phase, levelId, height: clears.height })
  }
}

/**
 * The last group of `phase` has settled (or been taken back): what was lifted for it comes back after
 * `holdMs`, in case more of the phase is coming.
 */
function releaseLifts(phase: RevealPhase, atMs: number, holdMs = LIFT_HOLD_MS) {
  for (const group of groups.values()) if (group.phase === phase) return
  for (const retract of retracts.values()) if (retract.group.phase === phase) return
  for (const [id, want] of [...liftWanted]) if (want.phase === phase) liftWanted.delete(id)
  for (const lift of lifts.values()) {
    if (lift.phase === phase && lift.releaseAt === null) lift.releaseAt = atMs + holdMs
  }
}

/**
 * The build is over (the agent's turn has ended): what lifted out of the way comes back down after
 * a beat, without waiting out the hold. Nothing happens when nothing is up.
 */
export function seatLiftedNow(): void {
  liftWanted.clear()
  changeLiftReleaseAt = null
  for (const lift of lifts.values()) {
    lift.releaseAt = Math.min(
      lift.releaseAt ?? Number.POSITIVE_INFINITY,
      liftClockMs + LIFT_BEAT_MS,
    )
  }
}

/** Seats `lift` exactly where it was, whole again. */
function seatLift(lift: Lift, atMs: number, say: boolean) {
  if (lift.root) {
    clearRevealPose(lift.root)
    clearGhost(lift.root)
  }
  lifts.delete(lift.id)
  if (!(say && deferredFinale)) return
  const finale = deferredFinale
  deferredFinale = null
  emit({ ...finale, id: lift.id, atMs })
}

function stepLifts(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - liftClockMs) / 1000))
  liftClockMs = now
  if (changeLiftReleaseAt !== null && now >= changeLiftReleaseAt && glides.size === 0) {
    changeLiftReleaseAt = null
    releaseLifts('furnishing', now)
  }
  const nodes = useScene.getState().nodes
  for (const [id, want] of [...liftWanted]) {
    if (!nodes[id as AnyNodeId]) {
      liftWanted.delete(id)
      continue
    }
    const root = sceneRegistry.nodes.get(id)
    if (!root || isNodeRevealing(id)) continue
    liftWanted.delete(id)
    lifts.set(id, {
      id,
      phase: want.phase,
      levelId: want.levelId,
      height: want.height,
      state: { x: 0, v: 0 },
      target: 1,
      releaseAt: null,
      root,
      // Ghosted ahead of the furniture already: its shaders have drawn.
      warm: ghostWarming.delete(id) ? 0 : LIFT_WARM_TICKS,
    })
  }
  for (const lift of [...lifts.values()]) {
    if (!nodes[lift.id as AnyNodeId]) {
      lifts.delete(lift.id)
      continue
    }
    lift.root = sceneRegistry.nodes.get(lift.id) ?? lift.root
    if (lift.warm > 0 && lift.root) {
      // The ghost's first draw pays for its shaders: it holds still until the frames are steady again.
      setGhost(lift.root, LIFT_WARM_OPACITY)
      if (frameQuiet) lift.warm -= 1
      continue
    }
    if (lift.releaseAt !== null && now >= lift.releaseAt) lift.target = 0
    criticallyDamped(
      lift.state,
      lift.target,
      lift.target === 1 ? LIFT_RESPONSE_UP_S : LIFT_RESPONSE_DOWN_S,
      dt,
    )
    const root = lift.root
    if (!root) continue
    if (lift.target === 0 && lift.state.x < 1e-3 && Math.abs(lift.state.v) < 1e-2) {
      seatLift(lift, now, true)
      continue
    }
    const x = Math.max(0, lift.state.x)
    setRevealPose(root, ORIGIN, UNIT, x * lift.height)
    // Never quite whole while it is up: whole would give the ghost's materials back, and their shaders with them.
    setGhost(root, Math.min(LIFT_WARM_OPACITY, 1 - (1 - LIFT_GHOST_MIN) * Math.min(1, x)))
  }
}

/** Everything that is up comes down at once: a load, an undo, a capture. */
function seatAllLifts() {
  for (const lift of [...lifts.values()]) seatLift(lift, liftClockMs, false)
  liftWanted.clear()
  deferredFinale = null
}

// ---------------------------------------------------------------------------------------------
// The build in reverse. An undo of what an agent built plays the construction backwards: the host
// asks `retractNodes` to take the nodes back, waits for it, and then removes them from the scene.
// The nodes stay hidden (held) until they leave the scene, so no frame shows them whole between.
// ---------------------------------------------------------------------------------------------

/** A node that has gone and is not yet out of the scene is held gone this long, then comes back. */
const RETRACT_HOLD_MS = 2000
/** A roof that lifts out of the way of the furniture going has this long to be most of the way up first. */
const RETRACT_LIFT_LEAD_MS = 450

type RetractGroup = {
  phase: RevealPhase
  levelId: string | null
  ids: string[]
  remaining: number
  started: boolean
}

type RetractRun = {
  retracted: string[]
  skipped: string[]
  remaining: number
  resolve: (result: RetractResult) => void
}

type Retract = {
  id: string
  style: RevealStyle
  height: number
  startMs: number
  durationMs: number
  /** Already up and faded when it began (a roof out of the way of the furniture): it carries on from there. */
  from: { lift: number; opacity: number }
  group: RetractGroup
  run: RetractRun
  root: Object3D | null
  pivot: Vector3 | null
}

type Held = {
  root: Object3D | null
  style: RevealStyle
  pivot: Vector3
  scale: Vector3
  lift: number
  fades: boolean
  until: number
}

const retracts = new Map<string, Retract>()
const held = new Map<string, Held>()
const retractSample: RetractPoseSample = { lift: 0, scale: new Vector3(), opacity: 1 }
/** Whether the host shows a build at once (animation off, reduced motion, the read-only viewer, an export). */
let showsAtOnce: () => boolean = () => true

/** What lifts away as it goes fades with it; what shrinks does not. */
const fadesAway = (style: RevealStyle) =>
  style === 'settle' || style === 'drop' || style === 'assemble'

function emitRetract(type: RevealRetractEvent['type'], group: RetractGroup, atMs: number) {
  emit({
    type,
    phase: group.phase,
    levelId: group.levelId,
    nodeIds: [...group.ids],
    source: null,
    atMs,
  })
}

function dressHeld(hold: Held, root: Object3D) {
  hold.root = root
  setRevealPose(root, hold.pivot, hold.scale, hold.lift)
  if (hold.fades) setGhost(root, 0)
}

function releaseHold(id: string, hold: Held) {
  held.delete(id)
  notifyPending(id)
  if (!hold.root) return
  clearRevealPose(hold.root)
  clearGhost(hold.root)
}

/** One piece has gone (or was cut short): its group ends with its last, and the run with its last group. */
function retractedAway(retract: Retract, atMs: number) {
  if (!retracts.delete(retract.id)) return
  const { group, run } = retract
  group.remaining -= 1
  if (group.remaining === 0) {
    if (!group.started) {
      group.started = true
      emitRetract('retract-start', group, atMs)
    }
    emitRetract('retract-end', group, atMs)
    // What lifted out of the way of this phase comes back down after a beat: there is no more of it.
    releaseLifts(group.phase, atMs, LIFT_BEAT_MS)
  }
  run.remaining -= 1
  if (run.remaining === 0)
    run.resolve({ retracted: run.retracted, skipped: run.skipped, instant: false })
}

/** Holds `retract`'s node gone, at the pose it ends in, until the host takes it out of the scene. */
function holdGone(retract: Retract, root: Object3D, atMs: number) {
  const pivot = retract.pivot ?? revealPivot(revealLocalBounds(root), retract.style)
  const end = retractPoseAt(retract.style, 1, retract.height, retractSample)
  const hold: Held = {
    root: null,
    style: retract.style,
    pivot,
    scale: end.scale.clone(),
    lift: retract.from.lift + end.lift,
    fades: fadesAway(retract.style),
    until: atMs + RETRACT_HOLD_MS,
  }
  held.set(retract.id, hold)
  dressHeld(hold, root)
  notifyPending(retract.id)
}

function stepRetracts(now: number) {
  const nodes = useScene.getState().nodes
  for (const retract of [...retracts.values()]) {
    if (!nodes[retract.id as AnyNodeId]) {
      // Taken out of the scene under it: nothing left to show going.
      if (retract.root) {
        clearRevealPose(retract.root)
        clearGhost(retract.root)
      }
      retractedAway(retract, now)
      continue
    }
    if (now < retract.startMs) continue
    const root = sceneRegistry.nodes.get(retract.id)
    if (!root) {
      if (now - retract.startMs > MOUNT_TIMEOUT_MS) retractedAway(retract, now)
      continue
    }
    if (retract.root !== root) {
      if (retract.root) {
        clearRevealPose(retract.root)
        clearGhost(retract.root)
      }
      retract.root = root
    }
    if (!retract.pivot) {
      retract.pivot = revealPivot(revealLocalBounds(root), retract.style)
      if (!retract.group.started) {
        retract.group.started = true
        emitRetract('retract-start', retract.group, now)
      }
    }
    const t = (now - retract.startMs) / retract.durationMs
    const pose = retractPoseAt(retract.style, t, retract.height, retractSample)
    setRevealPose(root, retract.pivot, pose.scale, retract.from.lift + pose.lift)
    if (fadesAway(retract.style)) setGhost(root, retract.from.opacity * pose.opacity)
    if (t >= 1) {
      holdGone(retract, root, now)
      retractedAway(retract, now)
    }
  }
  for (const [id, hold] of [...held]) {
    if (!nodes[id as AnyNodeId] || now >= hold.until) {
      releaseHold(id, hold)
      continue
    }
    const root = sceneRegistry.nodes.get(id)
    if (!root) continue
    if (root === hold.root) {
      // Its renderer may have dressed it in its own materials again.
      if (hold.fades) setGhost(root, 0)
      continue
    }
    if (hold.root) {
      clearRevealPose(hold.root)
      clearGhost(hold.root)
    }
    dressHeld(hold, root)
  }
}

/**
 * Ends every reverse play at once: what is going goes (and is held gone when the host is about to take
 * it out, `keepHeld`), or comes back whole (a capture, a load), and what waits on it resolves.
 */
function finishRetracts(keepHeld: boolean) {
  for (const retract of [...retracts.values()]) {
    const root = retract.root ?? sceneRegistry.nodes.get(retract.id) ?? null
    if (root && keepHeld) holdGone(retract, root, clockMs)
    else if (root) {
      clearRevealPose(root)
      clearGhost(root)
    }
    retractedAway(retract, clockMs)
  }
  if (keepHeld) return
  for (const [id, hold] of [...held]) releaseHold(id, hold)
}

/**
 * Takes `ids` back, and what stands under them, by playing their construction in reverse: the last
 * phase built goes first (the furniture lifts away, the roof, the openings close, the walls sink,
 * the slab), the last piece to arrive first within a phase, quicker than the build. It is what an
 * Undo of an agent's build shows before the host takes the nodes out of the scene: the promise
 * resolves when all have gone, the nodes stay hidden until they leave the scene (or a couple of seconds
 * pass, and they come back whole), and the host removes them then. `retract-start` and `retract-end`
 * events say each phase's turn, on the reveal's clock, for step cards, sounds and the camera.
 *
 * Nothing animates (so `instant` is true and nothing is retracted) when no reveal runs, the animation is
 * off, or motion is reduced: the host removes the nodes at once.
 */
export function retractNodes(ids: Iterable<string>): Promise<RetractResult> {
  const asked = [...new Set(ids)]
  if (currentDriver === null || showsAtOnce()) {
    return Promise.resolve({ retracted: [], skipped: asked, instant: true })
  }
  const nodes = useScene.getState().nodes
  const staged = nodeRevealCandidates(asked, nodes, revealLevel()).filter(
    (candidate) =>
      sceneRegistry.nodes.has(candidate.id) &&
      !pending.has(candidate.id) &&
      !retracts.has(candidate.id) &&
      !held.has(candidate.id) &&
      levelShown(candidate.levelId),
  )
  const taken = new Set(staged.map((candidate) => candidate.id))
  const skipped = asked.filter((id) => !taken.has(id))
  if (staged.length === 0) return Promise.resolve({ retracted: [], skipped, instant: false })

  // What is up for the furniture carries on up from where it is; a build still playing is shown first.
  const from = new Map<string, { lift: number; opacity: number }>()
  for (const { id } of staged) {
    const lifted = lifts.get(id)
    if (lifted) {
      const x = Math.max(0, lifted.state.x)
      from.set(id, { lift: x * lifted.height, opacity: 1 - (1 - LIFT_GHOST_MIN) * Math.min(1, x) })
      lifts.delete(id)
    }
    liftWanted.delete(id)
    finishNode(id)
  }
  if (lifts.size === 0 && liftWanted.size === 0) deferredFinale = null

  // The furniture goes in the open, as it came: the roof over it lifts out of the way first.
  const lifting = liftWanted.size
  for (const entry of new Map(staged.map((c) => [`${c.phase}:${c.levelId}`, c])).values()) {
    wantLifts(entry.phase, entry.levelId, taken)
  }
  // A roof that goes over the furniture that goes with it goes first: it is what lets the furniture be
  // seen leaving, as it lifted for it to be seen arriving.
  const stagedPhases = new Set(staged.map((candidate) => candidate.phase))
  const clearing = staged.filter((candidate) => {
    const node = nodes[candidate.id as AnyNodeId]
    const clears = node && nodeRegistry.get(node.type)?.capabilities?.reveal?.clears
    return clears !== undefined && stagedPhases.has(clears.for)
  })
  const clearingIds = new Set(clearing.map((candidate) => candidate.id))
  const roofFirst = clearing.some((candidate) => !from.has(candidate.id))
  const lead = liftWanted.size > lifting || roofFirst ? RETRACT_LIFT_LEAD_MS : 0
  const plan = [
    ...planRetract(clearing, clockMs),
    ...planRetract(
      staged.filter((candidate) => !clearingIds.has(candidate.id)),
      clockMs + lead,
    ),
  ].sort((left, right) => left.startMs - right.startMs)
  const end = Math.max(...plan.map((entry) => entry.startMs + entry.durationMs))
  // What was already up for a phase going has nothing left to make room for.
  const phases = new Set(plan.map((entry) => entry.phase))
  for (const lift of lifts.values()) {
    if (phases.has(lift.phase)) {
      lift.releaseAt = Math.min(lift.releaseAt ?? Number.POSITIVE_INFINITY, end + LIFT_BEAT_MS)
    }
  }
  return new Promise<RetractResult>((resolve) => {
    const run: RetractRun = {
      retracted: staged.map((candidate) => candidate.id),
      skipped,
      remaining: plan.length,
      resolve,
    }
    const groups = new Map<string, RetractGroup>()
    for (const entry of plan) {
      let group = groups.get(entry.group)
      if (!group) {
        group = {
          phase: entry.phase,
          levelId: entry.levelId,
          ids: [],
          remaining: 0,
          started: false,
        }
        groups.set(entry.group, group)
      }
      group.ids.push(entry.id)
      group.remaining += 1
      retracts.set(entry.id, {
        id: entry.id,
        style: entry.style,
        height: entry.height,
        startMs: entry.startMs,
        durationMs: entry.durationMs,
        from: from.get(entry.id) ?? { lift: 0, opacity: 1 },
        group,
        run,
        root: null,
        pivot: null,
      })
      // A plan entry that draws it hears that it is going.
      notifyPending(entry.id)
    }
    // With a roof to lift first, the first group is said to start now: the camera and the card move
    // with the roof, not a beat after it, and its pieces follow once the way is clear.
    const first = groups.get(plan[0]!.group)
    if (lead > 0 && first && !first.started) {
      first.started = true
      emitRetract('retract-start', first, clockMs)
    }
  })
}

function sayFinale(reveal: ActiveReveal, atMs: number) {
  reveal.finaleSaid = true
  // What is lifted seats last: that is the finish, not this piece's landing.
  if (lifts.size > 0 || liftWanted.size > 0) {
    deferredFinale = {
      type: 'finale',
      phase: reveal.candidate.phase,
      levelId: reveal.levelId,
      source: reveal.candidate.source ?? null,
    }
    return
  }
  emit({
    type: 'finale',
    id: reveal.id,
    phase: reveal.candidate.phase,
    levelId: reveal.levelId,
    source: reveal.candidate.source ?? null,
    atMs,
  })
}

/** Gives a warming node's meshes their culling back, and its place among the nodes that wait. */
function restoreWarm(id: string): boolean {
  const warm = warming.get(id)
  if (!warm) return false
  for (const [object, culled] of warm.culled) object.frustumCulled = culled
  warming.delete(id)
  return true
}

function hasWaitingAncestor(id: string, nodes: Record<string, AnyNode>): boolean {
  let parentId = nodes[id]?.parentId as string | null | undefined
  for (let guard = 0; parentId && guard < 32; guard += 1) {
    if (pending.has(parentId) && !warming.has(parentId)) return true
    parentId = nodes[parentId]?.parentId as string | null | undefined
  }
  return false
}

/**
 * A commit arrived: the first node of each kind not yet on screen mounts now, hidden, so its first draw
 * (and with it a stall of a hundred milliseconds or more) comes while nothing moves. An opening is left
 * for its turn, since mounting it cuts its wall; a part of an assembled node mounts with its host.
 * The roofs that will lift for the furniture of this commit draw once as the ghost they will become.
 */
function chooseWarm(now: number) {
  // Nothing draws when only the 2D plan shows: there are no shaders to build, and no frames to wait for.
  if (revealLevel() === 'off' || useViewer.getState().renderPaused) return
  const nodes = useScene.getState().nodes
  // What a node's first draw costs follows its shaders: its kind, and for a catalog item its model,
  // whose materials are its own.
  const shadersOf = (node: AnyNode) =>
    `${node.type}:${(node as { asset?: { id?: string } }).asset?.id ?? ''}`
  const onScreen = new Set<string>()
  const kinds = new Set<string>()
  const phases = new Set<RevealPhase>()
  let started = false
  let added = 0
  for (const candidate of pending.values()) {
    phases.add(candidate.phase)
    const candidateNode = nodes[candidate.id as AnyNodeId]
    if (!candidateNode || warming.has(candidate.id) || candidate.style === 'cut') continue
    const kind = shadersOf(candidateNode)
    if (kinds.has(kind)) continue
    if (!onScreen.has(candidateNode.type)) {
      onScreen.add(candidateNode.type)
      for (const id of sceneRegistry.byType[candidateNode.type] ?? []) {
        const mounted = nodes[id as AnyNodeId]
        if (mounted && !pending.has(id)) kinds.add(shadersOf(mounted))
      }
      if (kinds.has(kind)) continue
    }
    if (!levelShown(candidate.levelId) || hasWaitingAncestor(candidate.id, nodes)) continue
    kinds.add(kind)
    warming.set(candidate.id, { culled: new Map(), builtTicks: 0 })
    notifyPending(candidate.id)
    started = true
    added += 1
  }
  if (liftsPlay()) {
    for (const phase of phases) {
      for (const id in nodes) {
        const node = nodes[id as AnyNodeId]
        const clears = node && nodeRegistry.get(node.type)?.capabilities?.reveal?.clears
        const root = sceneRegistry.nodes.get(id)
        if (!(clears && clears.for === phase && root) || isNodeRevealing(id) || lifts.has(id))
          continue
        if (ghostWarming.has(id)) continue
        ghostWarming.set(id, 0)
        started = true
      }
    }
  }
  if (dust && !dustWarmed && added > 0) {
    dustWarmed = true
    dust.requestWarm()
    started = true
  }
  if (started) {
    warmWaiting = true
    warmStartedMs = now
    warmQuiet = 0
  }
}

/**
 * Keeps what mounted up front hidden, drawable (never culled), and counts the frames since it was
 * built; says when the plan may begin: everything has drawn and the frames are steady again.
 */
function stepWarm(now: number) {
  if (!warmWaiting && warming.size === 0 && ghostWarming.size === 0) return
  warmQuiet = frameQuiet ? warmQuiet + 1 : 0
  const { nodes, dirtyNodes } = useScene.getState()
  let ready = true
  for (const [id, warm] of [...warming]) {
    if (!nodes[id as AnyNodeId]) {
      restoreWarm(id)
      continue
    }
    const root = sceneRegistry.nodes.get(id)
    if (!root) {
      if (now - warmStartedMs < WARM_MOUNT_MS) ready = false
      continue
    }
    setRevealPose(root, ORIGIN, HIDDEN)
    root.traverse((object) => {
      if (warm.culled.has(object)) return
      warm.culled.set(object, object.frustumCulled)
      object.frustumCulled = false
    })
    if (dirtyNodes.has(id as AnyNodeId)) {
      ready = false
      continue
    }
    warm.builtTicks += 1
    if (warm.builtTicks < WARM_MIN_TICKS) ready = false
  }
  for (const [id, ticks] of [...ghostWarming]) {
    const root = sceneRegistry.nodes.get(id)
    if (!(nodes[id as AnyNodeId] && root)) {
      ghostWarming.delete(id)
      continue
    }
    setGhost(root, LIFT_WARM_OPACITY)
    ghostWarming.set(id, ticks + 1)
    if (ticks + 1 < WARM_MIN_TICKS) ready = false
  }
  if (
    warmWaiting &&
    ((ready && warmQuiet >= WARM_QUIET_FRAMES) || now - warmStartedMs >= WARM_MAX_MS)
  )
    warmWaiting = false
}

function tickReveals(now: number, frameMs?: number) {
  clockMs = now
  frameQuiet = frameMs === undefined || frameMs < WARM_QUIET_FRAME_MS
  if (revealLevel() === 'off' && (pending.size > 0 || active.size > 0 || retracts.size > 0))
    finishReveals()
  if (unplanned) {
    unplanned = false
    for (const candidate of [...pending.values()]) {
      if (!levelShown(candidate.levelId)) startReveal(candidate, now, false)
    }
    chooseWarm(now)
    replanning = true
  }
  stepWarm(now)
  if (replanning && !warmWaiting) {
    replanning = false
    queue = planReveal([...pending.values()], Math.max(now, lastStartMs + REVEAL_TIMING.nodeGapMs))
  }
  let due = 0
  while (due < queue.length && (queue[due]?.startMs ?? Number.POSITIVE_INFINITY) <= now) {
    const entry = queue[due++]!
    if (pending.has(entry.id)) startReveal(entry, now, levelShown(entry.levelId))
  }
  if (due > 0) queue = queue.slice(due)
  for (const reveal of active.values()) stepReveal(reveal, now)
  stepLifts(now)
  stepRetracts(now)
  stepGlides(now)
  const building = pending.size > 0 || active.size > 0 || lifts.size > 0 || liftWanted.size > 0
  if (!building) {
    announced.clear()
    // A roof ghosted ahead of furniture that never came goes back to its own materials.
    for (const id of ghostWarming.keys()) {
      const root = sceneRegistry.nodes.get(id)
      if (root && !lifts.has(id)) clearGhost(root)
    }
    ghostWarming.clear()
    completeBuild(now, false)
  }
  // No group is open and nothing waits for its turn: what the agent moved can begin without
  // closing a build's group early.
  if (changeQueue.length > 0 && groups.size === 0 && pending.size === 0 && active.size === 0) {
    flushChanges(now)
  }
  const busy =
    building || retracts.size > 0 || held.size > 0 || glides.size > 0 || changeQueue.length > 0
  if (busy || tickedBusy) notifyTicks()
  tickedBusy = busy
}

/**
 * Ends every reveal at once: waiting nodes mount, moving ones snap to their final pose, dust clears.
 * A reverse play ends too; its nodes stay gone when the host is about to remove them (`keepHeld`).
 */
function finishReveals(keepHeld = false) {
  const waiting = [...pending.values()]
  const busy = waiting.length > 0 || active.size > 0 || retracts.size > 0
  pending.clear()
  queue = []
  unplanned = false
  replanning = false
  warmWaiting = false
  for (const id of [...warming.keys()]) {
    restoreWarm(id)
    const root = sceneRegistry.nodes.get(id)
    if (root) clearRevealPose(root)
  }
  for (const id of ghostWarming.keys()) {
    const root = sceneRegistry.nodes.get(id)
    if (root && !lifts.has(id)) clearGhost(root)
  }
  ghostWarming.clear()
  for (const candidate of waiting) {
    released(candidate)
    settle(candidate.id)
    closeNode(candidate.id, clockMs, true)
  }
  for (const reveal of [...active.values()]) endReveal(reveal, true)
  announced.clear()
  dust?.clear()
  seatAllLifts()
  finishRetracts(keepHeld)
  finishChanges()
  completeBuild(clockMs, true)
  if (busy) notifyTicks()
}

/** Ends one node's reveal, and its parts' if it is assembled from them. */
function finishNode(id: string) {
  if (restoreWarm(id)) {
    const root = sceneRegistry.nodes.get(id)
    if (root) clearRevealPose(root)
  }
  const waiting = pending.get(id)
  if (waiting && pending.delete(id)) {
    released(waiting)
    settle(id)
    closeNode(id, clockMs, true)
  }
  const reveal = active.get(id)
  if (reveal) endReveal(reveal, true)
  const lifted = lifts.get(id)
  if (lifted) seatLift(lifted, clockMs, false)
  liftWanted.delete(id)
  finishGlide(id)
  const own = parts.get(id)
  if (own) for (const part of [...own]) finishNode(part)
}

/** Ends the reveal of `ids` and of their hosts. */
function finishNodes(ids: Iterable<string>) {
  const nodes = useScene.getState().nodes
  for (const id of ids) {
    let node = nodes[id as AnyNodeId]
    for (let guard = 0; node && guard < 32; guard += 1) {
      finishNode(node.id)
      node = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    }
  }
}

/** Whether a store change hid or showed a level that a waiting node stands on. */
function pendingLevelVisibilityChanged(
  nodes: Record<string, AnyNode>,
  previous: Record<string, AnyNode>,
): boolean {
  const seen = new Set<string>()
  for (const candidate of pending.values()) {
    const levelId = candidate.levelId
    if (!levelId || seen.has(levelId)) continue
    seen.add(levelId)
    if (nodes[levelId]?.visible !== previous[levelId]?.visible) return true
  }
  return false
}

function mediaPrefersReducedMotion(): () => boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => false
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  return () => query.matches
}

export type ConstructionRevealOptions = {
  /** Which commits stage their new nodes; every other commit appears at once. */
  reveals: (commit: SceneCommit) => boolean
  /** How much animation plays; defaults to `full`. Reduced motion always means `off`. */
  level?: () => ConstructionRevealLevel
  /** Defaults to the `prefers-reduced-motion` media query. */
  prefersReducedMotion?: () => boolean
  /** Where rising walls and landings puff their dust; none without it. */
  dust?: DustPool
}

export type ConstructionRevealDriver = {
  /**
   * Advances the reveal to `nowMs`, a monotonic frame clock. `frameMs` is how long the last frame really
   * took (the clock steps at most 50 ms a frame): a build waits for the frames to be steady again after
   * the first draw of a kind, which is when its shaders are built.
   */
  tick(nowMs: number, frameMs?: number): void
  /** Ends every reveal and stops listening. */
  stop(): void
}

let currentDriver: object | null = null

/**
 * The reveal without a canvas: `<ConstructionReveal>` calls `tick` every
 * frame. One driver runs at a time; a newer one takes over.
 */
export function startConstructionReveal(
  options: ConstructionRevealOptions,
): ConstructionRevealDriver {
  finishReveals()
  const token = {}
  currentDriver = token
  revealLevel = options.level ?? (() => 'full')
  dust = options.dust ?? null
  const reducedMotion = options.prefersReducedMotion ?? mediaPrefersReducedMotion()
  const instant = () => {
    const viewer = useViewer.getState()
    return (
      reducedMotion() ||
      revealLevel() === 'off' ||
      viewer.renderContext === 'viewer' ||
      viewer.isExporting
    )
  }
  showsAtOnce = instant
  const stops = [
    subscribeSceneCommits((commit) => {
      if (currentDriver !== token) return
      if (commit.origin === 'load') return finishReveals()
      if (!options.reveals(commit)) return
      const candidates = revealCandidates(commit, revealLevel())
      // Furniture the agent moved, that is shown and not still on its way in.
      const changes = commitChangeCandidates(commit, revealLevel()).filter(
        (change) =>
          !(pending.has(change.id) || active.has(change.id) || isNodeRevealing(change.id)) &&
          levelShown(change.levelId),
      )
      if (changes.length > 0) queueChanges(changes)
      if (candidates.length === 0) return
      registerCandidates(candidates, clockMs)
      if (instant()) {
        for (const candidate of candidates) announce(candidate)
        for (const candidate of candidates) closeNode(candidate.id, clockMs, false)
        completeBuild(clockMs, false)
        return
      }
      const assembling = new Set<string>()
      for (const candidate of candidates) {
        pending.set(candidate.id, candidate)
        if (candidate.host !== undefined) {
          if (!isRevealAssembling(candidate.host)) assembling.add(candidate.host)
          hostOf.set(candidate.id, candidate.host)
          const own = parts.get(candidate.host) ?? new Set<string>()
          parts.set(candidate.host, own.add(candidate.id))
        }
        notifyPending(candidate.id)
      }
      for (const hostId of assembling) notifyAssembly(hostId, true)
      unplanned = true
    }),
    useScene.subscribe((state, previous) => {
      if (currentDriver !== token) return
      if (isRestoringSceneHistory() || state.hydrationId !== previous.hydrationId) {
        // An undo is about to take what a reverse play was taking back out of the scene: it stays gone.
        return finishReveals(isRestoringSceneHistory())
      }
      // A waiting node on a level that just hid starts at once and holds no slot (failure mode 10).
      if (
        pending.size > 0 &&
        state.nodes !== previous.nodes &&
        pendingLevelVisibilityChanged(state.nodes, previous.nodes)
      ) {
        unplanned = true
      }
    }),
    useViewer.subscribe((state, previous) => {
      if (currentDriver !== token) return
      if (state.isExporting && !previous.isExporting) return finishReveals()
      if (
        state.selection.selectedIds !== previous.selection.selectedIds ||
        state.externalSelectedIds !== previous.externalSelectedIds ||
        state.previewSelectedIds !== previous.previewSelectedIds
      ) {
        finishNodes([
          ...state.selection.selectedIds,
          ...state.externalSelectedIds,
          ...state.previewSelectedIds,
        ])
      }
      if (
        pending.size > 0 &&
        (state.levelMode !== previous.levelMode ||
          state.selection.levelId !== previous.selection.levelId ||
          state.hideLevelsAboveSelection !== previous.hideLevelsAboveSelection)
      ) {
        unplanned = true
      }
    }),
  ]
  const onCapture = (policy: undefined | { readOnly: true }) => {
    if (policy?.readOnly) return
    if (currentDriver === token) finishReveals()
  }
  emitter.on('thumbnail:before-capture', onCapture)
  return {
    tick(nowMs, frameMs) {
      if (currentDriver === token) tickReveals(nowMs, frameMs)
    },
    stop() {
      for (const stop of stops) stop()
      emitter.off('thumbnail:before-capture', onCapture)
      if (currentDriver !== token) return
      currentDriver = null
      finishReveals()
      showsAtOnce = () => true
      dustWarmed = false
      changeQueue = []
      queuedChanges.clear()
      changeGroups.clear()
      changeGroupOf.clear()
      changeRun = null
      changeLiftReleaseAt = null
      glideClockMs = Number.NEGATIVE_INFINITY
      frameQuiet = true
      revealLevel = () => 'full'
      dust = null
      lastStartMs = Number.NEGATIVE_INFINITY
      buildLandedMs = Number.NEGATIVE_INFINITY
      liftClockMs = Number.NEGATIVE_INFINITY
      tickedBusy = false
    },
  }
}

/**
 * Mount inside `<Viewer>` to stage the commits `reveals` selects, at the
 * host's `level`. Hosts that never mount it (the read-only viewer, the bake)
 * show every write at once.
 */
export function ConstructionReveal({
  reveals,
  level = 'full',
}: {
  reveals: (commit: SceneCommit) => boolean
  level?: ConstructionRevealLevel
}) {
  const revealsRef = useRef(reveals)
  const levelRef = useRef(level)
  const driverRef = useRef<ConstructionRevealDriver | null>(null)
  const clockRef = useRef(0)
  const [pool] = useState(() => new DustPool())
  const renderPaused = useViewer((state) => state.renderPaused)

  useEffect(() => {
    revealsRef.current = reveals
  }, [reveals])

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    const driver = startConstructionReveal({
      reveals: (commit) => revealsRef.current(commit),
      level: () => levelRef.current,
      dust: pool,
    })
    driverRef.current = driver
    return () => {
      driver.stop()
      if (driverRef.current === driver) driverRef.current = null
    }
  }, [pool])

  // The canvas stops its frames when only the 2D plan shows; the plan still
  // plays the reveal, so the reveal keeps its own clock meanwhile.
  useEffect(() => {
    if (!renderPaused) return
    let request = 0
    let last: number | null = null
    const step = (time: number) => {
      request = requestAnimationFrame(step)
      const frameMs = last === null ? undefined : Math.max(0, time - last)
      if (frameMs !== undefined) clockRef.current += Math.min(MAX_STEP_MS, frameMs)
      last = time
      driverRef.current?.tick(clockRef.current, frameMs)
    }
    request = requestAnimationFrame(step)
    return () => cancelAnimationFrame(request)
  }, [renderPaused])

  useFrame((_, delta) => {
    clockRef.current += Math.min(MAX_STEP_MS, delta * 1000)
    driverRef.current?.tick(clockRef.current, delta * 1000)
  })

  return <ConstructionDust clock={clockRef} pool={pool} />
}
