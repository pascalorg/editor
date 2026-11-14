import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, create } from '@react-three/test-renderer'
import {
  SCENE_DATA_ATTRIBUTE,
  type SceneLoaderInput,
  type SceneLoaderState,
  useSceneLoader,
} from './use-scene-loader'

const TIMEOUT_MS = 20
const originalWindow = globalThis.window
const originalDocument = globalThis.document
const rootAttributes = new Map<string, string>()
const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
let renderer: Awaited<ReturnType<typeof create>> | undefined
let warn: ReturnType<typeof spyOn>

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = globalThis as unknown as Window & typeof globalThis
  rootAttributes.clear()
  globalThis.document = {
    documentElement: {
      setAttribute: (name: string, value: string) => rootAttributes.set(name, value),
      removeAttribute: (name: string) => rootAttributes.delete(name),
    },
  } as unknown as Document
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  globalThis.window = originalWindow
  globalThis.document = originalDocument
  actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  warn.mockRestore()
})

const fallbackWarnings = () =>
  warn.mock.calls.filter((args: unknown[]) => String(args[0]).includes('timed out')).length

type Input = Omit<SceneLoaderInput, 'viewerReadyTimeoutMs' | 'dataLoadTimeoutMs'>

async function mount(input: Input) {
  const states: SceneLoaderState[] = []
  function Host(props: Input) {
    states.push(
      useSceneLoader({
        ...props,
        viewerReadyTimeoutMs: TIMEOUT_MS,
        dataLoadTimeoutMs: TIMEOUT_MS,
      }),
    )
    return null
  }
  renderer = await create(<Host {...input} />)
  return {
    showLoader: () => states.at(-1)?.showLoader,
    sceneData: () => states.at(-1)?.sceneData,
    update: (next: Input) => renderer!.update(<Host {...next} />),
  }
}

const elapse = (ms = TIMEOUT_MS * 3) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

const sceneDataAttribute = () => rootAttributes.get(SCENE_DATA_ATTRIBUTE)

const loading: Input = {
  isHostLoading: false,
  isSceneDataLoading: true,
  isViewerSceneReady: false,
  hasLoadError: false,
  loadKey: '1:0',
}
const loaded: Input = { ...loading, isSceneDataLoading: false, loadKey: '1:1' }

test('clears when the scene loads and the viewer reports ready', async () => {
  const loader = await mount(loading)
  expect(loader.showLoader()).toBe(true)

  await loader.update(loaded)
  expect(loader.showLoader()).toBe(true)

  await loader.update({ ...loaded, isViewerSceneReady: true })
  expect(loader.showLoader()).toBe(false)
  await elapse()
  expect(fallbackWarnings()).toBe(0)
})

test('clears when viewer readiness times out, and a late "not ready" does not bring it back', async () => {
  const loader = await mount(loaded)
  expect(loader.showLoader()).toBe(true)

  await elapse()
  expect(loader.showLoader()).toBe(false)
  expect(fallbackWarnings()).toBe(1)

  // A viewer that mounts after the timeout reports ready, then resets on mount.
  await loader.update({ ...loaded, isViewerSceneReady: true })
  await loader.update({ ...loaded, isViewerSceneReady: false })
  expect(loader.showLoader()).toBe(false)
})

test('clears when isSceneLoading / hasLoadedInitialScene stay stuck', async () => {
  const loader = await mount(loading)
  expect(loader.showLoader()).toBe(true)
  await elapse()
  expect(loader.showLoader()).toBe(false)
})

test('clears when a host isLoading stays stuck after the scene loaded', async () => {
  const loader = await mount({ ...loaded, isHostLoading: true, isViewerSceneReady: true })
  expect(loader.showLoader()).toBe(true)
  await elapse()
  expect(loader.showLoader()).toBe(false)
})

test('a stuck load that restarts keeps one fallback timer running', async () => {
  const loader = await mount(loading)
  for (let i = 0; i < 3; i++) {
    await elapse(TIMEOUT_MS / 4)
    await loader.update({ ...loading })
  }
  await elapse()
  expect(loader.showLoader()).toBe(false)
})

test('a new load shows the loader again after an earlier fallback', async () => {
  const loader = await mount(loaded)
  await elapse()
  expect(loader.showLoader()).toBe(false)

  await loader.update({ ...loading, loadKey: '2:1' })
  expect(loader.showLoader()).toBe(true)
})

test('a load error keeps its surface up with no fallback', async () => {
  const loader = await mount({ ...loading, hasLoadError: true })
  await elapse()
  expect(loader.showLoader()).toBe(true)
  expect(fallbackWarnings()).toBe(0)
})

test('scene data: loading, then ready once the load completes', async () => {
  const loader = await mount(loading)
  expect(sceneDataAttribute()).toBe('loading')

  await loader.update(loaded)
  expect(sceneDataAttribute()).toBe('ready')
  await loader.update({ ...loaded, isViewerSceneReady: true })
  expect(loader.showLoader()).toBe(false)
  expect(sceneDataAttribute()).toBe('ready')

  await renderer!.unmount()
  renderer = undefined
  expect(sceneDataAttribute()).toBeUndefined()
})

test('scene data stays loading after the loader fallback, until the data arrives', async () => {
  const loader = await mount(loading)
  await elapse()
  expect(loader.showLoader()).toBe(false)
  expect(loader.sceneData()).toBe('loading')
  expect(sceneDataAttribute()).toBe('loading')

  await loader.update({ ...loaded, isViewerSceneReady: true })
  expect(loader.sceneData()).toBe('ready')
  expect(sceneDataAttribute()).toBe('ready')
})

test('a host isLoading does not hold the scene data state', async () => {
  const loader = await mount({ ...loaded, isHostLoading: true })
  expect(loader.showLoader()).toBe(true)
  expect(sceneDataAttribute()).toBe('ready')
})

test('scene data: failed on a load error, loading again on retry', async () => {
  const loader = await mount(loading)
  await loader.update({ ...loading, hasLoadError: true })
  expect(sceneDataAttribute()).toBe('failed')

  await loader.update({ ...loading, loadKey: '2:0' })
  expect(sceneDataAttribute()).toBe('loading')
  await loader.update({ ...loaded, loadKey: '2:1' })
  expect(sceneDataAttribute()).toBe('ready')
})
