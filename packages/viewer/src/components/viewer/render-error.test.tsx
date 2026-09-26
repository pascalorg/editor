import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useFrame } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import FrameLimiter from './frame-limiter'
import { composeRenderErrorHandlers, SceneErrorBoundary } from './render-error'

function FailingRenderer(): null {
  throw new Error('Failed to fetch dynamically imported module: /plugin-renderer.js')
}

function FailingSystem() {
  useFrame(() => {
    throw new Error('plugin system failed in a frame')
  })
  return null
}

// React reports caught render errors to the page (console, reportError); keep
// them quiet so what the handlers see is what the tests observe.
const originalError = console.error
const originalListeners = {
  add: globalThis.addEventListener,
  remove: globalThis.removeEventListener,
}
const originalReport = globalThis.reportError
beforeEach(() => {
  console.error = () => {}
  globalThis.reportError = () => {}
})
afterEach(() => {
  console.error = originalError
  globalThis.reportError = originalReport
})

test('a render error in the viewer scene reaches both the immersive session and the host', async () => {
  const seen: string[] = []
  const renderer = await create(
    <SceneErrorBoundary
      handlers={[
        (cause) => seen.push(`immersive: ${String(cause)}`),
        (cause) => seen.push(`host: ${String(cause)}`),
      ]}
    >
      <FailingRenderer />
    </SceneErrorBoundary>,
  )
  await renderer.unmount()
  expect(seen).toEqual([
    'immersive: Error: Failed to fetch dynamically imported module: /plugin-renderer.js',
    'host: Error: Failed to fetch dynamically imported module: /plugin-renderer.js',
  ])
})

test('a handler that throws does not stop the others', () => {
  const seen: string[] = []
  const onError = composeRenderErrorHandlers(
    () => {
      throw new Error('session handler broke')
    },
    (cause) => seen.push(String(cause)),
  )
  onError?.(new Error('render failed'))
  expect(seen).toEqual(['Error: render failed'])
  expect(composeRenderErrorHandlers(undefined, undefined)).toBeUndefined()
})

test('a system that throws in a frame reaches onFrameError, once, and frames keep coming', async () => {
  // FrameLimiter drives R3F's advance from requestAnimationFrame; drive it by hand.
  const frames: FrameRequestCallback[] = []
  const saved = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
  }
  const listeners = { addEventListener: () => {}, removeEventListener: () => {} }
  Object.assign(globalThis, {
    window: Object.assign(globalThis, listeners),
    document: { ...listeners, visibilityState: 'visible' },
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
    cancelAnimationFrame: () => {},
  })
  const seen: unknown[] = []
  try {
    const renderer = await create(
      <>
        <FrameLimiter fps={1000} onFrameError={(cause) => seen.push(cause)} />
        <FailingSystem />
      </>,
    )
    let time = 0
    for (let i = 0; i < 4; i++) {
      time += 10
      frames.shift()?.(time)
    }
    expect(seen).toHaveLength(1)
    expect(String(seen[0])).toBe('Error: plugin system failed in a frame')
    // The loop keeps scheduling frames after the failure.
    expect(frames.length).toBeGreaterThan(0)
    await renderer.unmount()
  } finally {
    Object.assign(globalThis, {
      window: saved.window,
      document: saved.document,
      requestAnimationFrame: saved.raf,
      cancelAnimationFrame: saved.caf,
    })
  }
})

test('the global listeners the frame test stubs are restored afterwards', () => {
  expect(globalThis.addEventListener).toBe(originalListeners.add)
  expect(globalThis.removeEventListener).toBe(originalListeners.remove)
})
