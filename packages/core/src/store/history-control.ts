import type { Collection, CollectionId } from '../schema/collections'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { withSceneHistoryDraftSuspended } from './history-drafts'
import {
  currentSceneEnvironment,
  type SceneEnvironment,
  sceneEnvironmentOf,
} from './scene-environment'

type GesturePauseHolder = { release: (() => void) | null; ended: boolean }

/** This module's state, one per scene environment (scene-environment.ts). */
type HistoryControlState = {
  restoreDepth: number
  remoteOperationDepth: number
  pauseDepth: number
  pauseLeases: Set<symbol>
  commitListeners: Set<SceneCommitListener>
  commitTransactionDepth: number
  pendingCommit: SceneCommit | null
  commitNodeIdScopes: Set<AnyNodeId>[]
  gesturePauseHolders: Map<string, Set<GesturePauseHolder>>
  livePauseHolders: Set<GesturePauseHolder>
  writeGuards: Set<() => void>
  derivedWrites: Map<AnyNodeId, Set<string> | 'all'>
}

const HISTORY_CONTROL = Symbol('scene-history-control')

function controlOf(environment: SceneEnvironment): HistoryControlState {
  return environment.slot(HISTORY_CONTROL, () => ({
    restoreDepth: 0,
    remoteOperationDepth: 0,
    pauseDepth: 0,
    pauseLeases: new Set(),
    commitListeners: new Set(),
    commitTransactionDepth: 0,
    pendingCommit: null,
    commitNodeIdScopes: [],
    gesturePauseHolders: new Map(),
    livePauseHolders: new Set(),
    writeGuards: new Set(),
    derivedWrites: new Map(),
  }))
}

/** The state of the environment whose store is acting, or the live one. */
const current = () => controlOf(currentSceneEnvironment())
/** The state of `store`'s own environment. */
const of = (store: object) => controlOf(sceneEnvironmentOf(store))

export function isRestoringSceneHistory(): boolean {
  return current().restoreDepth > 0
}

export function runAsSceneHistoryRestore<T>(run: () => T): T {
  const control = current()
  control.restoreDepth += 1
  try {
    return run()
  } finally {
    control.restoreDepth -= 1
  }
}

/**
 * Whether the scene is being written by a collaborator's change (a shared
 * operation or snapshot applied from the host), not by this client — what a
 * live session that takes back its own writes must leave alone.
 */
export function isApplyingRemoteSceneChange(): boolean {
  return current().remoteOperationDepth > 0
}

export function runAsRemoteSceneChange<T>(run: () => T): T {
  const control = current()
  control.remoteOperationDepth += 1
  try {
    return run()
  } finally {
    control.remoteOperationDepth -= 1
  }
}

export type SceneSnapshot = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  collections: Record<CollectionId, Collection>
  materials: Record<SceneMaterialId, SceneMaterial>
  installedPlugins: string[]
  hasExplicitPluginInstallState?: boolean
}

export type SceneCommitOrigin = 'local' | 'load' | 'host'

/**
 * Who made a local commit when it was not the person at the keyboard: `agent`
 * is an AI agent's tool write. Presentation reads it (the construction reveal
 * stages agent writes); the document and its history are the same either way.
 */
export type SceneCommitAuthor = 'agent'

export type SceneCommit = {
  origin: SceneCommitOrigin
  /** Absent for the person's own edits. See `runAsSceneCommitAuthor`. */
  author?: SceneCommitAuthor
  before: SceneSnapshot
  current: SceneSnapshot
  changedNodeIds?: ReadonlySet<AnyNodeId>
  /**
   * What the structure reconciler wrote while this commit was made (plates, ceilings, side
   * classification): derived from an edit, not authored by it. Each node it wrote, with the fields it
   * wrote (`'all'` for one it created or deleted). Presentation does not play these as the edit's own.
   */
  derivedWrites?: ReadonlyMap<AnyNodeId, ReadonlySet<string> | 'all'>
}

export type SceneCommitListener = (commit: SceneCommit) => void

type TemporalStoreLike = {
  temporal: {
    getState(): {
      pause(): void
      resume(): void
    }
  }
}

type TemporalHistoryStoreLike<TPastState> = {
  temporal: {
    getState(): {
      pastStates: TPastState[]
    }
    setState(state: { pastStates: TPastState[] }): void
  }
}

function mergedNodeIds(
  left: ReadonlySet<AnyNodeId> | undefined,
  right: ReadonlySet<AnyNodeId> | undefined,
) {
  if (!(left || right)) return undefined
  return new Set<AnyNodeId>([...(left ?? []), ...(right ?? [])])
}

export function activeSceneCommitNodeIds(): ReadonlySet<AnyNodeId> | undefined {
  const scopes = current().commitNodeIdScopes
  if (scopes.length === 0) return undefined
  const ids = new Set<AnyNodeId>()
  for (const scope of scopes) {
    for (const id of scope) ids.add(id)
  }
  return ids
}

export function addActiveSceneCommitNodeIds(nodeIds: Iterable<AnyNodeId>): void {
  const scope = current().commitNodeIdScopes.at(-1)
  if (!scope) return
  for (const id of nodeIds) scope.add(id)
}

export function runWithSceneCommitNodeIds<TResult>(
  nodeIds: Iterable<AnyNodeId>,
  run: () => TResult,
): TResult {
  const scopes = current().commitNodeIdScopes
  const scope = new Set(nodeIds)
  scopes.push(scope)
  try {
    return run()
  } finally {
    scopes.pop()
    const parentScope = scopes.at(-1)
    if (parentScope) {
      for (const id of scope) parentScope.add(id)
    }
  }
}

function areSemanticValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right)) || left.length !== right.length) return false
    return left.every((value, index) => areSemanticValuesEqual(value, right[index]))
  }

  if (typeof left !== 'object' || typeof right !== 'object') return false

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!(key in rightRecord) || !areSemanticValuesEqual(leftRecord[key], rightRecord[key])) {
      return false
    }
  }
  return true
}

export function areSceneSnapshotsEqual(left: SceneSnapshot, right: SceneSnapshot): boolean {
  return (
    areSemanticValuesEqual(left.nodes, right.nodes) &&
    areSemanticValuesEqual(left.rootNodeIds, right.rootNodeIds) &&
    areSemanticValuesEqual(left.collections, right.collections) &&
    areSemanticValuesEqual(left.materials, right.materials) &&
    areSemanticValuesEqual(left.installedPlugins, right.installedPlugins) &&
    (left.hasExplicitPluginInstallState ?? false) === (right.hasExplicitPluginInstallState ?? false)
  )
}

/** Listens to the commits of the current environment's store: the live editor's, by default. */
export function subscribeSceneCommits(listener: SceneCommitListener): () => void {
  const listeners = current().commitListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Registers something that must let go of the current environment's scene before anything writes
 * it: a preview that shows another state (`scene-preview.ts`) would otherwise swallow the write or
 * have it land on the wrong state. Returns the unregister.
 */
export function registerSceneWriteGuard(guard: () => void): () => void {
  const guards = current().writeGuards
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

/** Runs the guards of `sceneStore`'s environment, or of the current one. */
export function runSceneWriteGuards(sceneStore?: object): void {
  for (const guard of [...(sceneStore ? of(sceneStore) : current()).writeGuards]) guard()
}

const sceneCommitAuthorScopes: SceneCommitAuthor[] = []
const sceneCommitAuthorLeases = new Map<symbol, SceneCommitAuthor>()

export function activeSceneCommitAuthor(): SceneCommitAuthor | undefined {
  const scoped = sceneCommitAuthorScopes.at(-1)
  if (scoped) return scoped
  for (const author of sceneCommitAuthorLeases.values()) return author
  return undefined
}

/** Commits made while `run` runs carry `author`. */
export function runAsSceneCommitAuthor<TResult>(
  author: SceneCommitAuthor,
  run: () => TResult,
): TResult {
  runSceneWriteGuards()
  sceneCommitAuthorScopes.push(author)
  try {
    return run()
  } finally {
    sceneCommitAuthorScopes.pop()
  }
}

/**
 * The async form of `runAsSceneCommitAuthor`, for work that awaits between its
 * writes: commits carry `author` until the returned release runs. Every commit
 * in that window carries it, whoever made it, so hold it only around the
 * author's own work. Release is idempotent.
 */
export function acquireSceneCommitAuthor(author: SceneCommitAuthor): () => void {
  runSceneWriteGuards()
  const lease = Symbol('scene-commit-author')
  sceneCommitAuthorLeases.set(lease, author)
  return () => {
    sceneCommitAuthorLeases.delete(lease)
  }
}

/**
 * Records what the derived-writer capability writes, for the current environment's commit that
 * follows: each node, and the fields written (none given: the node as a whole).
 */
export function noteDerivedNodeWrites(
  writes: Iterable<{ id: AnyNodeId; fields?: Iterable<string> }>,
): void {
  const derivedWrites = current().derivedWrites
  for (const { id, fields } of writes) {
    const noted = derivedWrites.get(id)
    if (noted === 'all') continue
    if (!fields) derivedWrites.set(id, 'all')
    else derivedWrites.set(id, new Set([...(noted ?? []), ...fields]))
  }
}

function emitSceneCommit(control: HistoryControlState, authored: SceneCommit): void {
  const derived = control.derivedWrites
  control.derivedWrites = new Map()
  const commit = derived.size > 0 ? { ...authored, derivedWrites: derived } : authored
  for (const listener of [...control.commitListeners]) {
    try {
      listener(commit)
    } catch (error) {
      console.error('[Scene] Scene commit listener failed', error)
    }
  }
}

export function notifySceneCommit(commit: SceneCommit): void {
  const control = current()
  if (areSceneSnapshotsEqual(commit.before, commit.current)) {
    if (control.commitTransactionDepth === 0) control.derivedWrites = new Map()
    return
  }
  const author = commit.author ?? activeSceneCommitAuthor()
  const contextualCommit: SceneCommit = {
    ...commit,
    ...(author ? { author } : {}),
    changedNodeIds: mergedNodeIds(commit.changedNodeIds, activeSceneCommitNodeIds()),
  }

  if (control.commitTransactionDepth > 0) {
    const pending = control.pendingCommit
    if (pending) {
      const pendingAuthor = pending.author ?? contextualCommit.author
      control.pendingCommit = {
        origin: pending.origin,
        ...(pendingAuthor ? { author: pendingAuthor } : {}),
        before: pending.before,
        current: contextualCommit.current,
        changedNodeIds: mergedNodeIds(pending.changedNodeIds, contextualCommit.changedNodeIds),
      }
    } else {
      control.pendingCommit = contextualCommit
    }
    return
  }

  emitSceneCommit(control, contextualCommit)
}

/**
 * Makes `commit` the one `store`'s open transaction (`runAsSingleSceneHistoryStep`) emits: the
 * pending commit, if any, keeps its origin, author and `before` and takes `commit`'s `current`,
 * with both sets of changed ids. Outside a transaction, `commit` is emitted.
 */
export function settlePendingSceneCommit(store: object, commit: SceneCommit): void {
  const control = of(store)
  if (control.commitTransactionDepth === 0) {
    sceneEnvironmentOf(store).run(() => notifySceneCommit(commit))
    return
  }
  const pending = control.pendingCommit
  const author = pending?.author ?? commit.author ?? activeSceneCommitAuthor()
  control.pendingCommit = {
    origin: pending?.origin ?? commit.origin,
    ...(author ? { author } : {}),
    before: pending?.before ?? commit.before,
    current: commit.current,
    changedNodeIds: mergedNodeIds(pending?.changedNodeIds, commit.changedNodeIds),
  }
}

function pendingSceneCommitIsNoOp(control: HistoryControlState): boolean {
  const pending = control.pendingCommit
  return Boolean(pending && areSceneSnapshotsEqual(pending.before, pending.current))
}

function endSceneCommitTransaction(control: HistoryControlState): void {
  if (control.commitTransactionDepth === 0) return
  control.commitTransactionDepth -= 1
  if (control.commitTransactionDepth > 0) return

  const commit = control.pendingCommit
  control.pendingCommit = null
  if (!commit) return
  if (areSceneSnapshotsEqual(commit.before, commit.current)) control.derivedWrites = new Map()
  else emitSceneCommit(control, commit)
}

const pauseDepthOf = (control: HistoryControlState) => control.pauseDepth + control.pauseLeases.size

export function pauseSceneHistory(sceneStore: TemporalStoreLike): void {
  const control = of(sceneStore)
  if (pauseDepthOf(control) === 0) {
    sceneStore.temporal.getState().pause()
  }
  control.pauseDepth += 1
}

export function resumeSceneHistory(sceneStore: TemporalStoreLike): void {
  const control = of(sceneStore)
  if (control.pauseDepth === 0) {
    return
  }

  control.pauseDepth -= 1
  if (pauseDepthOf(control) === 0) {
    sceneStore.temporal.getState().resume()
  }
}

export function acquireSceneHistoryPause(sceneStore: TemporalStoreLike): () => void {
  const control = of(sceneStore)
  if (pauseDepthOf(control) === 0) {
    sceneStore.temporal.getState().pause()
  }
  const lease = Symbol('scene-history-pause')
  control.pauseLeases.add(lease)
  let released = false
  return () => {
    if (released) return
    released = true
    control.pauseLeases.delete(lease)
    if (pauseDepthOf(control) === 0) {
      sceneStore.temporal.getState().resume()
    }
  }
}

export type SceneHistoryPauseSession = {
  /**
   * Runs one committing write with this gesture's pauses lifted, then takes them back.
   * The write lands as tracked history only when no other owner is pausing it.
   */
  commitStep<T>(write: () => T): T
  /** Releases this session's pause. Idempotent. */
  end(): void
}

export type SceneHistoryPauseSessionOptions = {
  /** Sessions with the same key co-own one gesture; see `beginSceneHistoryPauseSession`. */
  gesture?: string
}

/** Lifts `holders`' pauses for `write`, then takes back those that have not ended. */
function runWithHoldersLifted<T>(
  sceneStore: TemporalStoreLike,
  holders: Iterable<GesturePauseHolder>,
  write: () => T,
): T {
  const lifted = [...holders].filter((holder) => holder.release)
  for (const holder of lifted) {
    const release = holder.release!
    holder.release = null
    release()
  }
  try {
    return write()
  } finally {
    for (const holder of lifted) {
      if (!holder.ended) holder.release = acquireSceneHistoryPause(sceneStore)
    }
  }
}

/**
 * Holds a refcounted pause for a whole gesture (drag). Unlike a raw
 * `temporal.pause()`, cooperating systems see the gesture through
 * `getSceneHistoryPauseDepth()`, and their balanced pause/resume pairs cannot
 * resume history under it.
 *
 * Sessions opened with the same `gesture` key co-own the gesture (the 3D mover
 * and the 2D move overlay of one moving node): either one's `commitStep` lifts
 * both pauses, so whichever view drops records the one step.
 */
export function beginSceneHistoryPauseSession(
  sceneStore: TemporalStoreLike,
  options: SceneHistoryPauseSessionOptions = {},
): SceneHistoryPauseSession {
  const { gesture } = options
  const environment = sceneEnvironmentOf(sceneStore)
  const control = controlOf(environment)
  const holder: GesturePauseHolder = {
    release: acquireSceneHistoryPause(sceneStore),
    ended: false,
  }
  control.livePauseHolders.add(holder)
  let coOwners = new Set([holder])
  if (gesture) {
    coOwners = control.gesturePauseHolders.get(gesture) ?? new Set()
    coOwners.add(holder)
    control.gesturePauseHolders.set(gesture, coOwners)
  }
  return {
    commitStep(write) {
      return environment.run(() =>
        runWithHoldersLifted(sceneStore, coOwners, () =>
          withSceneHistoryDraftSuspended(gesture, write),
        ),
      )
    },
    end() {
      if (holder.ended) return
      holder.ended = true
      holder.release?.()
      holder.release = null
      control.livePauseHolders.delete(holder)
      coOwners.delete(holder)
      if (gesture && coOwners.size === 0) control.gesturePauseHolders.delete(gesture)
    },
  }
}

/** Pauses held on `sceneStore`'s history, or on the current environment's store's. */
export function getSceneHistoryPauseDepth(sceneStore?: object): number {
  return pauseDepthOf(sceneStore ? of(sceneStore) : current())
}

export function resetSceneHistoryPauseDepth(sceneStore?: object): void {
  const control = sceneStore ? of(sceneStore) : current()
  control.pauseDepth = 0
  control.pauseLeases.clear()
  // Open sessions no longer hold anything; a later commitStep must not re-take their pause.
  for (const holder of control.livePauseHolders) holder.release = null
  control.livePauseHolders.clear()
  control.gesturePauseHolders.clear()
}

function retainedPastStateCount<TPastState>(before: TPastState[], after: TPastState[]): number {
  for (let start = 0; start < before.length; start += 1) {
    const retained = before.length - start
    if (retained > after.length) continue
    let matches = true
    for (let index = 0; index < retained; index += 1) {
      if (before[start + index] !== after[index]) {
        matches = false
        break
      }
    }
    if (matches) return retained
  }
  return 0
}

export function runAsSingleSceneHistoryStep<TPastState, TResult>(
  sceneStore: TemporalHistoryStoreLike<TPastState>,
  run: () => TResult,
): TResult {
  const environment = sceneEnvironmentOf(sceneStore)
  const control = controlOf(environment)
  const beforePastStates = sceneStore.temporal.getState().pastStates
  control.commitTransactionDepth += 1
  try {
    const result = environment.run(run)
    const afterPastStates = sceneStore.temporal.getState().pastStates
    const retainedCount = retainedPastStateCount(beforePastStates, afterPastStates)
    const addedCount = afterPastStates.length - retainedCount

    if (addedCount > 0 && pendingSceneCommitIsNoOp(control)) {
      sceneStore.temporal.setState({ pastStates: afterPastStates.slice(0, retainedCount) })
    } else if (addedCount > 1) {
      const firstAddedState = afterPastStates[retainedCount]
      if (firstAddedState !== undefined) {
        sceneStore.temporal.setState({
          pastStates: [...afterPastStates.slice(0, retainedCount), firstAddedState],
        })
      }
    }
    return result
  } finally {
    endSceneCommitTransaction(control)
  }
}
