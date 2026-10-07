import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { create } from '@react-three/test-renderer'
import { Suspense } from 'react'
import { FileLoader } from 'three'
import { ErrorBoundary } from '../components/error-boundary'
import { useJsonArtifactPayload } from './use-json-artifact'

afterEach(() => {
  mock.restore()
})

function Preview({ url }: { url: string }) {
  const payload = useJsonArtifactPayload(url)
  return payload ? <group name="loaded" userData={{ payload }} /> : null
}

test('a failed artifact can load after resetting its error boundary without reloading the page', async () => {
  spyOn(console, 'error').mockImplementation(() => {})
  spyOn(globalThis, 'reportError').mockImplementation(() => {})
  const load = spyOn(FileLoader.prototype, 'load')
  const failure = new Error('Temporarily unavailable')
  const payload = { positions: [1, 2, 3] }
  load.mockImplementationOnce((_url, _loaded, _progress, failed) => {
    queueMicrotask(() => failed?.(failure))
  })
  load.mockImplementation((_url, loaded) => {
    queueMicrotask(() => loaded?.(payload))
  })
  const view = (retryKey: number) => (
    <ErrorBoundary fallback={<group name="failed" />} resetKey={retryKey}>
      <Suspense fallback={null}>
        <Preview url="https://capture.test/retry-points.json" />
      </Suspense>
    </ErrorBoundary>
  )
  const renderer = await create(view(0))
  try {
    expect(renderer.scene.findAllByProps({ name: 'failed' })).toHaveLength(1)
    expect(load).toHaveBeenCalledTimes(1)
    await renderer.update(view(1))
    expect(renderer.scene.findAllByProps({ name: 'failed' })).toHaveLength(0)
    expect(renderer.scene.findAllByProps({ name: 'loaded' })).toHaveLength(1)
    expect(load).toHaveBeenCalledTimes(2)
  } finally {
    await renderer.unmount()
  }
})

test('returning to a successful artifact reuses its parsed payload', async () => {
  const load = spyOn(FileLoader.prototype, 'load')
  const payload = { positions: [1, 2, 3] }
  load.mockImplementation((_url, loaded) => {
    queueMicrotask(() => loaded?.(payload))
  })
  const view = (
    <Suspense fallback={null}>
      <Preview url="https://capture.test/cached-points.json" />
    </Suspense>
  )
  const renderer = await create(view)
  try {
    expect(renderer.scene.findByProps({ name: 'loaded' }).props.userData.payload).toBe(payload)
    await renderer.update(<group />)
    await renderer.update(view)
    expect(renderer.scene.findByProps({ name: 'loaded' }).props.userData.payload).toBe(payload)
    expect(load).toHaveBeenCalledTimes(1)
  } finally {
    await renderer.unmount()
  }
})
