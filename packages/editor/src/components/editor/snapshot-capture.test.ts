import { describe, expect, test } from 'bun:test'
import type {
  SnapshotCaptureFailedEvent,
  SnapshotCapturePose,
  ThumbnailGenerateEvent,
} from '@pascal-app/core'
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import {
  applySnapshotCapturePose,
  captureSnapshotScene,
  createSnapshotQueue,
  enqueueSnapshotCapture,
  isOverlaySnapshotSave,
  runSnapshotCapture,
} from './snapshot-capture'

test('manual capture feedback ignores background requests and other projects', () => {
  const saved = { id: 'frame', url: 'https://example.test/frame.webp', width: 1920, height: 1080 }
  expect(isOverlaySnapshotSave(undefined, 'project')).toBe(true)
  expect(isOverlaySnapshotSave(saved, 'project')).toBe(true)
  expect(isOverlaySnapshotSave({ ...saved, projectId: 'project' }, 'project')).toBe(true)
  expect(isOverlaySnapshotSave({ ...saved, projectId: 'other' }, 'project')).toBe(false)
  expect(isOverlaySnapshotSave({ ...saved, requestId: 'background' }, 'project')).toBe(false)
})

describe('capture scene restoration', () => {
  test('restores all presentation changes before GPU readback settles', async () => {
    const events: string[] = []
    let readback!: (value: string) => void
    const result = captureSnapshotScene((restore) => {
      restore(() => events.push('levels restored'))
      restore(() => events.push('materials restored'))
      events.push('rendered')
      return new Promise<string>((resolve) => {
        readback = resolve
      })
    })
    expect(events).toEqual(['rendered', 'materials restored', 'levels restored'])
    readback('frame')
    expect(await result).toBe('frame')
  })

  test('a setup failure still restores every already-applied change', async () => {
    let restored = false
    await expect(
      captureSnapshotScene((restore) => {
        restore(() => {
          restored = true
        })
        throw new Error('Framing failed')
      }),
    ).rejects.toThrow('Framing failed')
    expect(restored).toBe(true)
  })

  test('an after-capture listener failure cannot prevent level and visibility restoration', async () => {
    const restored: string[] = []
    await expect(
      captureSnapshotScene((restore) => {
        restore(() => {
          restored.push('levels')
        })
        restore(() => {
          restored.push('visibility')
        })
        restore(() => {
          throw new Error('Listener failed')
        })
        return Promise.reject(new Error('Readback failed'))
      }),
    ).rejects.toThrow('Listener failed')
    expect(restored).toEqual(['visibility', 'levels'])
    await Promise.resolve()
  })
})

describe('explicit snapshot camera', () => {
  const pose: SnapshotCapturePose = {
    position: [4, 2, -3],
    quaternion: new Quaternion().setFromEuler(new Euler(0.2, 1.1, 0.6)).toArray(),
    fov: 47,
  }

  test('retains the authored world pose including roll without moving the viewport camera', () => {
    const viewportCamera = new PerspectiveCamera(65, 2, 0.1, 1000)
    viewportCamera.position.set(10, 20, 30)
    viewportCamera.rotation.set(0.9, 0.8, 0.7)
    const previousPosition = viewportCamera.position.toArray()
    const previousQuaternion = viewportCamera.quaternion.toArray()
    const captureCamera = viewportCamera.clone()

    applySnapshotCapturePose(
      captureCamera,
      pose,
      { width: 1600, height: 900 },
      { w: 1920, h: 1080 },
    )

    expect(captureCamera.position.toArray()).toEqual(pose.position)
    expect(captureCamera.quaternion.toArray()).toEqual(pose.quaternion)
    expect(captureCamera.fov).toBeCloseTo(pose.fov, 10)
    expect(viewportCamera.position.toArray()).toEqual(previousPosition)
    expect(viewportCamera.quaternion.toArray()).toEqual(previousQuaternion)
  })

  test.each([
    { width: 900, height: 1600, w: 1920, h: 1080 },
    { width: 1600, height: 900, w: 1080, h: 1920 },
    { width: 1440, height: 900, w: 1920, h: 1080 },
  ])('matches the authored composition after center crop: %j', ({ width, height, w, h }) => {
    const capture = new PerspectiveCamera()
    applySnapshotCapturePose(capture, pose, { width, height }, { w, h })
    const ideal = new PerspectiveCamera(pose.fov, w / h)
    ideal.position.fromArray(pose.position)
    ideal.quaternion.fromArray(pose.quaternion)
    ideal.updateMatrixWorld()
    const worldPoint = new Vector3(0.4, 0.7, -7)
      .applyQuaternion(ideal.quaternion)
      .add(ideal.position)
    const expected = worldPoint.clone().project(ideal)
    const actual = worldPoint.clone().project(capture)
    const cropHeight = width / height < w / h ? Math.round(width / (w / h)) : height
    const cropWidth = width / height > w / h ? Math.round(height * (w / h)) : width

    expect((actual.x * width) / cropWidth).toBeCloseTo(expected.x, 3)
    expect((actual.y * height) / cropHeight).toBeCloseTo(expected.y, 10)
  })

  test('rejects a malformed lens before mutating the capture camera', () => {
    const camera = new PerspectiveCamera()
    expect(() =>
      applySnapshotCapturePose(
        camera,
        { ...pose, fov: Number.NaN },
        { width: 1600, height: 900 },
        { w: 1920, h: 1080 },
      ),
    ).toThrow('Invalid snapshot camera pose or dimensions')
    expect(camera.position.toArray()).toEqual([0, 0, 0])
  })
})

describe('snapshot request correlation', () => {
  test('queued authored frames survive a viewport camera and callback replacement', async () => {
    const enqueue = createSnapshotQueue()
    const version = { current: 1 }
    const failures: SnapshotCaptureFailedEvent[] = []
    const captured: ThumbnailGenerateEvent[] = []
    let release!: () => void
    const background = enqueue(
      {},
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await Promise.resolve()
    let viewportCamera = new PerspectiveCamera()
    const pose: SnapshotCapturePose = {
      position: [4, 2, -3],
      quaternion: [0, 0, 0, 1],
      fov: 47,
    }
    const event: ThumbnailGenerateEvent = {
      projectId: 'project',
      requestId: 'frame',
      captureMode: 'standard',
      cameraPose: pose,
    }
    const generate = async (request: ThumbnailGenerateEvent) => {
      const captureCamera = viewportCamera.clone()
      applySnapshotCapturePose(
        captureCamera,
        request.cameraPose!,
        { width: 1600, height: 900 },
        { w: 1920, h: 1080 },
      )
      expect(captureCamera.position.toArray()).toEqual(pose.position)
      captured.push(request)
    }
    const first = enqueueSnapshotCapture(enqueue, version, event, generate, (failure) =>
      failures.push(failure),
    )
    viewportCamera = new PerspectiveCamera(90)
    viewportCamera.position.set(20, 10, 5)
    const second = enqueueSnapshotCapture(
      enqueue,
      version,
      { ...event, requestId: 'next-frame' },
      async (request) => generate(request),
      (failure) => failures.push(failure),
    )
    release()
    await Promise.all([background, first, second])
    expect(captured.map((request) => request.requestId)).toEqual(['frame', 'next-frame'])
    expect(viewportCamera.position.toArray()).toEqual([20, 10, 5])
    expect(failures).toEqual([])
  })

  test('disposing the capture pipeline cancels queued frames before the replacement scene renders', async () => {
    const enqueue = createSnapshotQueue()
    const version = { current: 1 }
    const failures: SnapshotCaptureFailedEvent[] = []
    const captured: string[] = []
    let release!: () => void
    const background = enqueue(
      {},
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await Promise.resolve()
    const capture = async (event: ThumbnailGenerateEvent) => {
      captured.push(event.requestId!)
    }
    const oldFrame = enqueueSnapshotCapture(
      enqueue,
      version,
      { projectId: 'old', requestId: 'old-frame' },
      capture,
      (failure) => failures.push(failure),
    )
    version.current += 1
    const newFrame = enqueueSnapshotCapture(
      enqueue,
      version,
      { projectId: 'new', requestId: 'new-frame' },
      capture,
      (failure) => failures.push(failure),
    )
    release()
    await Promise.all([background, oldFrame, newFrame])
    expect(captured).toEqual(['new-frame'])
    expect(failures).toEqual([
      { requestId: 'old-frame', error: 'The scene changed before capture. Try again.' },
    ])
  })

  test.each([
    'standard',
    'viewport',
    'area',
  ] as const)('a manual %s shutter waits for a background upload; redundant autosaves are dropped', async (captureMode) => {
    const enqueue = createSnapshotQueue()
    const busy = { current: false }
    const failures: SnapshotCaptureFailedEvent[] = []
    const events: string[] = []
    let finishUpload!: () => void
    const uploading = new Promise<void>((resolve) => {
      finishUpload = resolve
    })
    const background = enqueue({ requestId: 'background' }, () =>
      runSnapshotCapture(
        'background',
        busy,
        async () => {
          events.push('background rendered')
          await uploading
          events.push('background saved')
        },
        (failure) => failures.push(failure),
      ),
    )
    await Promise.resolve()
    expect(busy.current).toBe(true)
    const autosave = enqueue({}, async () => {
      events.push('autosave')
    })
    let overlayState = 'capturing'
    const manual = enqueue({ captureMode }, () =>
      runSnapshotCapture(
        undefined,
        busy,
        async () => {
          events.push('manual saved')
          overlayState = 'saved'
        },
        (failure) => failures.push(failure),
      ),
    )
    await autosave
    expect(overlayState).toBe('capturing')
    expect(events).toEqual(['background rendered'])
    finishUpload()
    await Promise.all([background, manual])
    expect(events).toEqual(['background rendered', 'background saved', 'manual saved'])
    expect(overlayState).toBe('saved')
    expect(failures).toEqual([])
    expect(busy.current).toBe(false)
    await enqueue({}, async () => {
      events.push('idle autosave')
    })
    expect(events.at(-1)).toBe('idle autosave')
  })

  test('queues a frame dispatched by a save callback until the previous capture releases its lock', async () => {
    const enqueue = createSnapshotQueue()
    const busy = { current: false }
    const failures: SnapshotCaptureFailedEvent[] = []
    const events: string[] = []
    let second: Promise<void> | undefined
    await enqueue({ requestId: 'first' }, () =>
      runSnapshotCapture(
        'first',
        busy,
        async () => {
          events.push('first saved')
          second = enqueue({ requestId: 'second' }, () =>
            runSnapshotCapture(
              'second',
              busy,
              async () => {
                events.push('second saved')
              },
              (failure) => failures.push(failure),
            ),
          )
          await Promise.resolve()
          events.push('first callback returned')
        },
        (failure) => failures.push(failure),
      ),
    )
    await second
    expect(events).toEqual(['first saved', 'first callback returned', 'second saved'])
    expect(failures).toEqual([])
  })

  test('a rejected queue task does not strand later captures', async () => {
    const enqueue = createSnapshotQueue()
    await expect(
      enqueue({}, async () => {
        throw new Error('Failed')
      }),
    ).rejects.toThrow('Failed')
    let captured = false
    await enqueue({}, async () => {
      captured = true
    })
    expect(captured).toBe(true)
  })
  test('reports only the rejected request as busy and allows the next capture after completion', async () => {
    const busy = { current: false }
    const failures: SnapshotCaptureFailedEvent[] = []
    const completed: string[] = []
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const first = runSnapshotCapture(
      'first',
      busy,
      async () => {
        await pending
        completed.push('first')
      },
      (failure) => failures.push(failure),
    )

    await runSnapshotCapture(
      'second',
      busy,
      async () => {
        completed.push('second')
      },
      (failure) => failures.push(failure),
    )
    expect(failures).toEqual([
      {
        requestId: 'second',
        error: 'Another snapshot is being captured. Try again.',
      },
    ])
    expect(completed).toEqual([])
    expect(busy.current).toBe(true)

    finish()
    await first
    await runSnapshotCapture(
      'third',
      busy,
      async () => {
        completed.push('third')
      },
      (failure) => failures.push(failure),
    )
    expect(completed).toEqual(['first', 'third'])
    expect(busy.current).toBe(false)
  })

  test('correlates render failures and releases the capture lock', async () => {
    const busy = { current: false }
    const failures: SnapshotCaptureFailedEvent[] = []
    await runSnapshotCapture(
      'failed-frame',
      busy,
      async () => {
        throw new Error('GPU readback failed')
      },
      (failure) => failures.push(failure),
    )

    expect(failures).toEqual([{ requestId: 'failed-frame', error: 'GPU readback failed' }])
    expect(busy.current).toBe(false)
  })

  test('uncorrelated legacy requests still capture', async () => {
    let captured = false
    const failures: SnapshotCaptureFailedEvent[] = []
    await runSnapshotCapture(
      undefined,
      { current: false },
      async () => {
        captured = true
      },
      (failure) => failures.push(failure),
    )
    expect(captured).toBe(true)
    expect(failures).toEqual([])
  })
})
