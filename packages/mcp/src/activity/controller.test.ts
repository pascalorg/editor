import { describe, expect, test } from 'bun:test'
import { AgentRunController, type AgentRunSnapshot, type AgentRunTask } from './controller'

const TASK: AgentRunTask = {
  category: 'structure',
  label: 'Build the ground floor',
  target: 'level-0',
}

function createController(revision = 0) {
  return new AgentRunController({ runId: 'run-1', sceneId: 'scene-1', revision, task: TASK })
}

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('Expected work to reject')
    },
    (error) => error,
  )
}

describe('AgentRunController', () => {
  test('pause rejects pending work before commit and acknowledges only after drain', async () => {
    const controller = createController()
    const gate = deferred()
    let commits = 0
    let signal: AbortSignal | undefined
    const execution = controller.execute(controller.lease(), TASK, async (context) => {
      signal = context.signal
      await gate.promise
      context.assertCanCommit()
      commits += 1
      return { revision: 1 }
    })
    const rejected = rejection(execution)
    const paused = controller.pause()
    expect(controller.snapshot()).toMatchObject({ status: 'pausing', inFlight: true, epoch: 1 })
    expect(signal?.aborted).toBe(true)
    let acknowledged = false
    void paused.then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)
    await expect(controller.humanEdit(0, async () => ({ revision: 1 }))).rejects.toThrow('pausing')
    gate.resolve()
    expect((await rejected).message).toContain('cancelled')
    expect(await paused).toMatchObject({
      status: 'paused',
      inFlight: false,
      completedSteps: 0,
      revision: 0,
    })
    expect(commits).toBe(0)
  })

  test('a commit already admitted can finish before pause acknowledges', async () => {
    const controller = createController()
    const receipt = deferred()
    let committed = false
    const execution = controller.execute(controller.lease(), TASK, async ({ assertCanCommit }) => {
      assertCanCommit()
      committed = true
      await receipt.promise
      return { revision: 1, value: 'wall-1' }
    })
    expect(committed).toBe(true)
    const paused = controller.pause()
    expect(controller.snapshot().status).toBe('pausing')
    receipt.resolve()
    expect(await execution).toEqual({ revision: 1, value: 'wall-1' })
    expect(await paused).toMatchObject({ status: 'paused', revision: 1, completedSteps: 1 })
  })

  test('stop closes admission synchronously and duplicate control requests share their receipt', async () => {
    const controller = createController()
    const gate = deferred()
    const lease = controller.lease()
    const execution = controller.execute(lease, TASK, async ({ signal }) => {
      await gate.promise
      signal.throwIfAborted()
      return { revision: 0 }
    })
    const rejected = rejection(execution)
    const paused = controller.pause()
    expect(controller.pause()).toBe(paused)
    const stopped = controller.stop()
    expect(stopped).toBe(paused)
    expect(controller.stop()).toBe(stopped)
    expect(controller.snapshot()).toMatchObject({ status: 'stopping', epoch: 2 })
    await expect(controller.execute(lease, TASK, async () => ({ revision: 1 }))).rejects.toThrow(
      'stale',
    )
    gate.resolve()
    expect((await rejected).message).toContain('cancelled')
    expect(await paused).toMatchObject({ status: 'stopped', inFlight: false })
    const epoch = controller.snapshot().epoch
    expect((await controller.stop()).epoch).toBe(epoch)
  })

  test('old leases never revive after pause, human edit and rebase', async () => {
    const controller = createController()
    const oldLease = controller.lease()
    await controller.pause()
    await controller.humanEdit(0, async ({ assertCanCommit }) => {
      assertCanCommit()
      return { revision: 1 }
    })
    const resumeLease = controller.resume()
    expect(controller.snapshot().status).toBe('resuming')
    await expect(
      controller.execute(resumeLease, TASK, async () => ({ revision: 1 })),
    ).rejects.toThrow('resuming')
    expect(() => controller.acknowledgeRebase(resumeLease, 0)).toThrow('current scene revision')
    controller.acknowledgeRebase(resumeLease, 1)
    await expect(controller.execute(oldLease, TASK, async () => ({ revision: 2 }))).rejects.toThrow(
      'stale',
    )
    await controller.execute(resumeLease, TASK, async ({ assertCanCommit }) => {
      assertCanCommit()
      return { revision: 2 }
    })
    expect(controller.snapshot()).toMatchObject({
      status: 'running',
      revision: 2,
      completedSteps: 1,
    })
  })

  test('a stopped run cannot resume but retains controlled human edits', async () => {
    const controller = createController()
    await controller.stop()
    expect(() => controller.resume()).toThrow('stopped')
    await controller.humanEdit(0, async ({ assertCanCommit }) => {
      assertCanCommit()
      return { revision: 1 }
    })
    expect(controller.snapshot()).toMatchObject({ status: 'stopped', revision: 1 })
  })

  test('human writes and resume cannot overlap in either order', async () => {
    const controller = createController(3)
    await controller.pause()
    const gate = deferred()
    const human = controller.humanEdit(3, async ({ assertCanCommit }) => {
      await gate.promise
      assertCanCommit()
      return { revision: 4 }
    })
    expect(() => controller.resume()).toThrow('in flight')
    expect(() => controller.stop()).toThrow('Human edit')
    await expect(controller.humanEdit(3, async () => ({ revision: 5 }))).rejects.toThrow(
      'in flight',
    )
    gate.resolve()
    await human
    const lease = controller.resume()
    await expect(controller.humanEdit(4, async () => ({ revision: 5 }))).rejects.toThrow('resuming')
    controller.acknowledgeRebase(lease, 4)
    expect(controller.snapshot().completedSteps).toBe(0)
  })

  test('concurrent agent calls are rejected rather than queued', async () => {
    const controller = createController()
    const gate = deferred()
    const lease = controller.lease()
    const first = controller.execute(lease, TASK, async () => {
      await gate.promise
      return { revision: 1 }
    })
    let ranSecond = false
    await expect(
      controller.execute(lease, TASK, async () => {
        ranSecond = true
        return { revision: 2 }
      }),
    ).rejects.toThrow('does not queue')
    gate.resolve()
    await first
    expect(ranSecond).toBe(false)
    await expect(controller.execute(lease, TASK, async () => ({ revision: 2 }))).rejects.toThrow(
      'stale',
    )
  })

  test('wrong-run and forged revision leases do not invoke work', async () => {
    const controller = createController(7)
    let calls = 0
    const work = async () => {
      calls += 1
      return { revision: 8 }
    }
    await expect(
      controller.execute({ ...controller.lease(), runId: 'run-2' }, TASK, work),
    ).rejects.toThrow('another run')
    await expect(
      controller.execute({ ...controller.lease(), revision: 6 }, TASK, work),
    ).rejects.toThrow('stale')
    expect(calls).toBe(0)
    expect(controller.snapshot().status).toBe('running')
  })

  test('uncertain failure rejects handoff and requires explicit scene reconciliation', async () => {
    const controller = createController(4)
    const gate = deferred()
    const execution = controller.execute(controller.lease(), TASK, async ({ assertCanCommit }) => {
      assertCanCommit()
      await gate.promise
      throw new Error('Commit response was lost')
    })
    const failed = rejection(execution)
    const paused = controller.pause()
    const refused = rejection(paused)
    gate.resolve()
    for (const error of await Promise.all([failed, refused])) {
      expect(error.message).toContain('response was lost')
    }
    expect(controller.snapshot()).toMatchObject({
      status: 'failed',
      inFlight: false,
      revision: 4,
      completedSteps: 0,
    })
    await expect(controller.humanEdit(4, async () => ({ revision: 5 }))).rejects.toThrow('failed')
    expect(() => controller.stop()).toThrow('failed')
    expect(() => controller.resume()).toThrow('failed')
    expect(() => controller.reconcile(3)).toThrow('backwards')
    expect(controller.reconcile(5)).toMatchObject({ status: 'paused', revision: 5 })
    expect(controller.snapshot().error).toBeUndefined()
  })

  test('an abort after commit permission is uncertain, even for controller cancellation', async () => {
    const controller = createController()
    const gate = deferred()
    const execution = controller.execute(
      controller.lease(),
      TASK,
      async ({ assertCanCommit, signal }) => {
        assertCanCommit()
        await gate.promise
        signal.throwIfAborted()
        return { revision: 1 }
      },
    )
    const failed = rejection(execution)
    const stopped = controller.stop()
    const refused = rejection(stopped)
    gate.resolve()
    for (const error of await Promise.all([failed, refused])) {
      expect(error.message).toContain('cancelled')
    }
    expect(controller.snapshot().status).toBe('failed')
  })

  test('ordinary callback failure does not silently grant control', async () => {
    const controller = createController()
    await expect(
      controller.execute(controller.lease(), TASK, async () => {
        throw new Error('Unexpected host failure')
      }),
    ).rejects.toThrow('Unexpected host failure')
    expect(controller.snapshot()).toMatchObject({ status: 'failed', completedSteps: 0 })
    expect(() => controller.pause()).toThrow('failed')
  })

  test('human failure also requires reconciliation', async () => {
    const controller = createController()
    await controller.stop()
    await expect(
      controller.humanEdit(0, async () => {
        throw new Error('Human commit response was lost')
      }),
    ).rejects.toThrow('response was lost')
    expect(controller.snapshot().status).toBe('failed')
    await expect(controller.humanEdit(0, async () => ({ revision: 1 }))).rejects.toThrow('failed')
  })

  test('resume acknowledgement is invalidated by another control request', async () => {
    const controller = createController()
    await controller.pause()
    const first = controller.resume()
    await controller.pause()
    const second = controller.resume()
    expect(() => controller.acknowledgeRebase(first, 0)).toThrow('stale')
    controller.acknowledgeRebase(second, 0)
    expect(() => controller.acknowledgeRebase(second, 0)).toThrow('running')
  })

  test('complete is terminal and cannot run while a step is in flight', async () => {
    const controller = createController()
    const gate = deferred()
    const execution = controller.execute(controller.lease(), TASK, async () => {
      await gate.promise
      return { revision: 0 }
    })
    expect(() => controller.complete()).toThrow('in flight')
    gate.resolve()
    await execution
    const snapshot = controller.complete()
    expect(snapshot.status).toBe('completed')
    expect(controller.complete()).toEqual(snapshot)
    expect(() => controller.resume()).toThrow('completed')
    await expect(
      controller.execute(controller.lease(), TASK, async () => ({ revision: 1 })),
    ).rejects.toThrow('completed')
    await controller.humanEdit(0, async ({ assertCanCommit }) => {
      assertCanCommit()
      return { revision: 1 }
    })
    expect(controller.snapshot()).toMatchObject({ status: 'completed', revision: 1 })
  })

  test('snapshot progress remains bounded, immutable and independent of caller tasks', async () => {
    const task: AgentRunTask = { category: 'check', label: 'Check the scene' }
    const controller = new AgentRunController({
      runId: 'run-1',
      sceneId: 'scene-1',
      revision: 0,
      task,
    })
    const snapshots: AgentRunSnapshot[] = []
    const unsubscribe = controller.subscribe((snapshot) => snapshots.push(snapshot))
    task.label = 'Mutated outside'
    const first = controller.snapshot()
    expect(first.task.label).toBe('Check the scene')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.task)).toBe(true)
    for (let index = 0; index < 50; index += 1) {
      await controller.execute(controller.lease(), TASK, async () => ({
        revision: index + 1,
        value: 'x'.repeat(1000),
      }))
    }
    expect(controller.snapshot()).toMatchObject({
      completedSteps: 50,
      inFlight: false,
      revision: 50,
    })
    expect(JSON.stringify(controller.snapshot()).length).toBeLessThan(400)
    expect(first).toMatchObject({ completedSteps: 0, revision: 0 })
    unsubscribe()
    const count = snapshots.length
    await controller.pause()
    expect(snapshots.length).toBe(count)
  })

  test('observer failure cannot strand a handoff or change execution outcome', async () => {
    const controller = createController()
    let seen = 0
    controller.subscribe(() => {
      throw new Error('Broken UI observer')
    })
    controller.subscribe(() => {
      seen += 1
    })
    await controller.execute(controller.lease(), TASK, async () => ({ revision: 1 }))
    expect((await controller.pause()).status).toBe('paused')
    expect(seen).toBe(3)
  })

  test('reentrant pause from a start observer prevents the callback from starting', async () => {
    const controller = createController()
    let paused: Promise<AgentRunSnapshot> | undefined
    let callbackRan = false
    controller.subscribe((snapshot) => {
      if (snapshot.status === 'running' && snapshot.inFlight) paused = controller.pause()
    })
    await expect(
      controller.execute(controller.lease(), TASK, async () => {
        callbackRan = true
        return { revision: 1 }
      }),
    ).rejects.toThrow('cancelled')
    expect((await paused)?.status).toBe('paused')
    expect(callbackRan).toBe(false)
  })

  test('invalid or backwards result revisions fail closed and progress is not counted', async () => {
    for (const revision of [Number.NaN, Infinity, -1, 0.5, 2]) {
      const controller = createController(3)
      await expect(
        controller.execute(controller.lease(), TASK, async () => ({ revision })),
      ).rejects.toThrow()
      expect(controller.snapshot()).toMatchObject({
        status: 'failed',
        revision: 3,
        completedSteps: 0,
      })
    }
    expect(() => createController(Number.NaN)).toThrow('safe integer')
  })

  test('commits must advance revisions while read-only agent steps may preserve them', async () => {
    const reader = createController(3)
    await reader.execute(
      reader.lease(),
      { category: 'check', label: 'Inspect floor' },
      async () => ({ revision: 3 }),
    )
    expect(reader.snapshot()).toMatchObject({ status: 'running', revision: 3, completedSteps: 1 })
    await expect(
      reader.execute(reader.lease(), TASK, async ({ assertCanCommit }) => {
        assertCanCommit()
        return { revision: 3 }
      }),
    ).rejects.toThrow('must advance')
    expect(reader.snapshot().status).toBe('failed')
    const human = createController(3)
    await human.pause()
    await expect(human.humanEdit(3, async () => ({ revision: 3 }))).rejects.toThrow('must advance')
    expect(human.snapshot().status).toBe('failed')
  })

  test('reconciling a failed human edit cannot restart a terminal agent run', async () => {
    for (const status of ['stopped', 'completed'] as const) {
      const controller = createController()
      if (status === 'stopped') await controller.stop()
      else controller.complete()
      await expect(
        controller.humanEdit(0, async () => {
          throw new Error('Lost human edit result')
        }),
      ).rejects.toThrow('Lost human edit result')
      expect(controller.reconcile(1).status).toBe(status)
      expect(() => controller.resume()).toThrow(status)
    }
  })

  test('reconciling an uncertain stop preserves stop intent', async () => {
    const controller = createController()
    const gate = deferred()
    const execution = controller.execute(controller.lease(), TASK, async ({ assertCanCommit }) => {
      assertCanCommit()
      await gate.promise
      throw new Error('Lost commit result')
    })
    const failed = rejection(execution)
    const stopped = rejection(controller.stop())
    gate.resolve()
    await Promise.all([failed, stopped])
    expect(controller.reconcile(1).status).toBe('stopped')
    expect(() => controller.resume()).toThrow('stopped')
  })

  test('work starts synchronously and its commit guard expires when work settles', async () => {
    const controller = createController()
    let started = false
    let guard = () => {}
    const execution = controller.execute(controller.lease(), TASK, async ({ assertCanCommit }) => {
      started = true
      guard = assertCanCommit
      return { revision: 0 }
    })
    expect(started).toBe(true)
    expect(controller.snapshot().inFlight).toBe(true)
    await execution
    expect(() => guard()).toThrow('no longer active')
  })

  test('reentrant controls never deliver an older snapshot after a newer one', async () => {
    const controller = createController()
    const observed: { status: string; epoch: number }[] = []
    controller.subscribe((snapshot) => {
      if (snapshot.status === 'running' && snapshot.inFlight) void controller.pause()
    })
    controller.subscribe(({ status, epoch }) => observed.push({ status, epoch }))
    await expect(
      controller.execute(controller.lease(), TASK, async () => ({ revision: 1 })),
    ).rejects.toThrow('cancelled')
    expect(observed).toEqual([
      { status: 'pausing', epoch: 1 },
      { status: 'paused', epoch: 1 },
    ])
  })
})
