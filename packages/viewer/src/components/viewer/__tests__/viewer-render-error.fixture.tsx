import { afterAll, beforeAll, expect, mock, test } from 'bun:test'

// The real <Viewer>, with R3F's DOM <Canvas> replaced by its children: the test
// renderer already provides the R3F root, and no GPU is needed.
const fiber = await import('@react-three/fiber')
mock.module('@react-three/fiber', () => ({
  ...fiber,
  Canvas: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
const { create } = await import('@react-three/test-renderer')
const { default: Viewer } = await import('../index')

function FailingRenderer(): null {
  throw new Error('Failed to fetch dynamically imported module: /plugin-renderer.js')
}

function FailingSystem() {
  fiber.useFrame(() => {
    throw new Error('plugin system failed in a frame')
  })
  return null
}

const frames: FrameRequestCallback[] = []
const saved: Record<string, unknown> = {}
const STUBBED = [
  'window',
  'document',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'addEventListener',
  'removeEventListener',
  'matchMedia',
  'reportError',
  'location',
  'localStorage',
] as const
const quiet = { error: console.error, warn: console.warn, log: console.log }

beforeAll(() => {
  for (const key of STUBBED) saved[key] = Reflect.get(globalThis, key)
  const listeners = { addEventListener: () => {}, removeEventListener: () => {} }
  Object.assign(globalThis, {
    ...listeners,
    matchMedia: () => ({ matches: false, ...listeners }),
    reportError: () => {},
    location: { search: '', hash: '', href: 'http://localhost/' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
    cancelAnimationFrame: () => {},
  })
  Object.assign(globalThis, {
    window: globalThis,
    document: { ...listeners, visibilityState: 'visible', hidden: false },
  })
  // The fallback renderer and empty registry log on mount; only the handlers matter here.
  console.error = () => {}
  console.warn = () => {}
  console.log = () => {}
})

afterAll(() => {
  for (const key of STUBBED) Reflect.set(globalThis, key, saved[key])
  Object.assign(console, quiet)
})

test('a node that throws while rendering reaches <Viewer onRenderError>', async () => {
  const seen: string[] = []
  const renderer = await create(
    <Viewer disablePostFx onRenderError={(cause) => seen.push(String(cause))}>
      <FailingRenderer />
    </Viewer>,
  )
  expect(seen).toContain('Error: Failed to fetch dynamically imported module: /plugin-renderer.js')
  await renderer.unmount()
})

test('a system that throws in a frame reaches <Viewer onRenderError>', async () => {
  const seen: string[] = []
  const renderer = await create(
    <Viewer disablePostFx onRenderError={(cause) => seen.push(String(cause))}>
      <FailingSystem />
    </Viewer>,
  )
  let time = 0
  for (let i = 0; i < 4; i++) {
    time += 100
    frames.shift()?.(time)
  }
  expect(seen).toContain('Error: plugin system failed in a frame')
  await renderer.unmount()
})
