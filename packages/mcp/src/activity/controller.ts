export type AgentRunCategory = 'plan' | 'structure' | 'furnish' | 'finish' | 'check' | 'edit'

export interface AgentRunTask {
  category: AgentRunCategory
  label: string
  target?: string
}

export type AgentRunStatus =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'

export interface AgentRunLease {
  readonly runId: string
  readonly epoch: number
  readonly revision: number
}

export interface AgentRunSnapshot extends AgentRunLease {
  readonly sceneId: string
  readonly status: AgentRunStatus
  readonly task: Readonly<AgentRunTask>
  readonly completedSteps: number
  readonly inFlight: boolean
  readonly error?: string
}

export interface AgentRunWorkContext {
  signal: AbortSignal
  // Call immediately before starting each commit, without an intervening await.
  assertCanCommit: () => void
}

export interface AgentRunWorkResult<Value = unknown> {
  revision: number
  value?: Value
}

type Work<Value> = (context: AgentRunWorkContext) => Promise<AgentRunWorkResult<Value>>

interface ActiveWork {
  abort: AbortController
  commitAuthorized: boolean
  kind: 'agent' | 'human'
  lease: AgentRunLease
}

interface ControlAcknowledgement {
  promise: Promise<AgentRunSnapshot>
  resolve: (snapshot: AgentRunSnapshot) => void
  reject: (error: Error) => void
}

const CATEGORIES: ReadonlySet<string> = new Set([
  'plan',
  'structure',
  'furnish',
  'finish',
  'check',
  'edit',
])

function requireText(value: string, name: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error(`${name} must be a nonempty string of at most ${limit} characters`)
  }
  return value
}

function requireRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Scene revision must be a nonnegative safe integer')
  }
  return revision
}

function copyTask(task: AgentRunTask): Readonly<AgentRunTask> {
  if (!task || !CATEGORIES.has(task.category)) throw new Error('Unknown agent task category')
  return Object.freeze({
    category: task.category,
    label: requireText(task.label, 'Task label', 240),
    ...(task.target === undefined ? {} : { target: requireText(task.target, 'Task target', 240) }),
  })
}

/** Coordinates one cooperating host; it does not fence independent scene writers. */
export class AgentRunController {
  private readonly runId: string
  private readonly sceneId: string
  private revision: number
  private epoch = 0
  private status: AgentRunStatus = 'running'
  private task: Readonly<AgentRunTask>
  private completedSteps = 0
  private error: string | undefined
  private reconciledStatus: 'paused' | 'stopped' | 'completed' = 'paused'
  private active: ActiveWork | null = null
  private acknowledgement: ControlAcknowledgement | null = null
  private publication = 0
  private readonly listeners = new Set<(snapshot: AgentRunSnapshot) => void>()

  constructor(input: { runId: string; sceneId: string; revision: number; task: AgentRunTask }) {
    this.runId = requireText(input.runId, 'Run ID', 256)
    this.sceneId = requireText(input.sceneId, 'Scene ID', 256)
    this.revision = requireRevision(input.revision)
    this.task = copyTask(input.task)
  }

  snapshot(): AgentRunSnapshot {
    return Object.freeze({
      ...this.lease(),
      sceneId: this.sceneId,
      status: this.status,
      task: this.task,
      completedSteps: this.completedSteps,
      inFlight: this.active !== null,
      ...(this.error === undefined ? {} : { error: this.error }),
    })
  }

  subscribe(listener: (snapshot: AgentRunSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  lease(): AgentRunLease {
    return Object.freeze({ runId: this.runId, epoch: this.epoch, revision: this.revision })
  }

  async execute<Value>(
    lease: AgentRunLease,
    task: AgentRunTask,
    work: Work<Value>,
  ): Promise<AgentRunWorkResult<Value>> {
    this.requireLease(lease)
    this.requireStatus('running')
    this.requireIdle()
    const nextTask = copyTask(task)
    this.task = nextTask
    return this.perform('agent', work)
  }

  pause(): Promise<AgentRunSnapshot> {
    if (this.status === 'paused') {
      this.requireIdle()
      return Promise.resolve(this.snapshot())
    }
    if (this.status === 'pausing' || this.status === 'stopping') {
      return this.requireAcknowledgement()
    }
    this.requireStatus('running', 'resuming')
    return this.requestControl('pausing')
  }

  stop(): Promise<AgentRunSnapshot> {
    if (this.status === 'stopped' || this.status === 'completed') {
      this.requireIdle()
      return Promise.resolve(this.snapshot())
    }
    if (this.status === 'stopping') return this.requireAcknowledgement()
    this.requireStatus('running', 'pausing', 'paused', 'resuming')
    if (this.active?.kind === 'human') throw new Error('Human edit is still in flight')
    return this.requestControl('stopping')
  }

  async humanEdit<Value>(
    expectedRevision: number,
    work: Work<Value>,
  ): Promise<AgentRunWorkResult<Value>> {
    this.requireStatus('paused', 'stopped', 'completed')
    this.requireIdle()
    if (requireRevision(expectedRevision) !== this.revision) {
      throw new Error('Human edit has a stale scene revision')
    }
    return this.perform('human', work)
  }

  resume(): AgentRunLease {
    this.requireStatus('paused')
    this.requireIdle()
    this.epoch += 1
    this.status = 'resuming'
    const lease = this.lease()
    this.publish()
    return lease
  }

  acknowledgeRebase(lease: AgentRunLease, observedRevision: number): AgentRunSnapshot {
    this.requireLease(lease)
    this.requireStatus('resuming')
    this.requireIdle()
    if (requireRevision(observedRevision) !== this.revision) {
      throw new Error('Rebase must observe the current scene revision')
    }
    this.status = 'running'
    const snapshot = this.snapshot()
    this.publish()
    return snapshot
  }

  // Only call after rereading the authoritative scene and resolving an uncertain outcome.
  reconcile(observedRevision: number): AgentRunSnapshot {
    this.requireStatus('failed')
    this.requireIdle()
    this.acceptRevision(observedRevision)
    this.epoch += 1
    this.status = this.reconciledStatus
    this.error = undefined
    const snapshot = this.snapshot()
    this.publish()
    return snapshot
  }

  complete(): AgentRunSnapshot {
    if (this.status === 'completed') return this.snapshot()
    this.requireStatus('running')
    this.requireIdle()
    this.epoch += 1
    this.status = 'completed'
    const snapshot = this.snapshot()
    this.publish()
    return snapshot
  }

  private async perform<Value>(
    kind: ActiveWork['kind'],
    work: Work<Value>,
  ): Promise<AgentRunWorkResult<Value>> {
    const active: ActiveWork = {
      abort: new AbortController(),
      commitAuthorized: false,
      kind,
      lease: this.lease(),
    }
    this.active = active
    this.publish()
    try {
      active.abort.signal.throwIfAborted()
      const result = await work({
        signal: active.abort.signal,
        assertCanCommit: () => {
          active.abort.signal.throwIfAborted()
          if (this.active !== active) throw new Error('Work is no longer active')
          this.requireLease(active.lease)
          if (kind === 'agent') this.requireStatus('running')
          else this.requireStatus('paused', 'stopped', 'completed')
          active.commitAuthorized = true
        },
      })
      this.acceptRevision(result?.revision, kind === 'human' || active.commitAuthorized)
      if (kind === 'agent') this.completedSteps += 1
      return result
    } catch (error) {
      const cancelledBeforeCommit =
        active.abort.signal.aborted &&
        error === active.abort.signal.reason &&
        !active.commitAuthorized
      if (!cancelledBeforeCommit) {
        this.reconciledStatus =
          this.status === 'completed'
            ? 'completed'
            : this.status === 'stopped' || this.status === 'stopping'
              ? 'stopped'
              : 'paused'
        this.status = 'failed'
        this.epoch += 1
        this.error = (error instanceof Error ? error.message : String(error)).slice(0, 1024)
      }
      throw error
    } finally {
      this.active = null
      if (this.status === 'pausing') this.status = 'paused'
      else if (this.status === 'stopping') this.status = 'stopped'
      const acknowledgement = this.acknowledgement
      this.acknowledgement = null
      if (this.status === 'failed') {
        acknowledgement?.reject(new Error(this.error ?? 'Agent work outcome is uncertain'))
      } else {
        acknowledgement?.resolve(this.snapshot())
      }
      this.publish()
    }
  }

  private requestControl(status: 'pausing' | 'stopping'): Promise<AgentRunSnapshot> {
    this.status = status
    this.epoch += 1
    if (!this.acknowledgement) {
      let resolve: ControlAcknowledgement['resolve'] = () => {}
      let reject: ControlAcknowledgement['reject'] = () => {}
      const promise = new Promise<AgentRunSnapshot>((onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
      })
      this.acknowledgement = { promise, resolve, reject }
    }
    const acknowledgement = this.acknowledgement
    this.active?.abort.abort(new Error('Agent work cancelled before another commit'))
    if (!this.active) {
      this.status = status === 'pausing' ? 'paused' : 'stopped'
      this.acknowledgement = null
      acknowledgement.resolve(this.snapshot())
    }
    this.publish()
    return acknowledgement.promise
  }

  private requireAcknowledgement(): Promise<AgentRunSnapshot> {
    if (!this.acknowledgement) throw new Error('Missing control acknowledgement')
    return this.acknowledgement.promise
  }

  private requireLease(lease: AgentRunLease): void {
    if (
      !lease ||
      lease.runId !== this.runId ||
      lease.epoch !== this.epoch ||
      lease.revision !== this.revision
    ) {
      throw new Error('Agent lease is stale or belongs to another run')
    }
  }

  private requireStatus(...allowed: AgentRunStatus[]): void {
    if (!allowed.includes(this.status)) throw new Error(`Agent run is ${this.status}`)
  }

  private requireIdle(): void {
    if (this.active) throw new Error('Work is already in flight; this controller does not queue')
  }

  private acceptRevision(revision: number, committed = false): void {
    if (requireRevision(revision) < this.revision) throw new Error('Scene revision moved backwards')
    if (committed && revision === this.revision) {
      throw new Error('A committed edit must advance the scene revision')
    }
    this.revision = revision
  }

  private publish(): void {
    const snapshot = this.snapshot()
    const publication = ++this.publication
    for (const listener of [...this.listeners]) {
      // A reentrant control request has already published a newer state to these observers.
      if (publication !== this.publication) return
      try {
        listener(snapshot)
      } catch {
        // An observer must not interrupt a commit or its handoff acknowledgement.
        this.listeners.delete(listener)
      }
    }
  }
}
