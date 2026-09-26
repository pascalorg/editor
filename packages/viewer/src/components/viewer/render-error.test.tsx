import { expect, test } from 'bun:test'
import { create } from '@react-three/test-renderer'
import { ErrorBoundary } from '../error-boundary'
import { composeRenderErrorHandlers } from './render-error'

function FailingRenderer(): null {
  throw new Error('Failed to fetch dynamically imported module: /plugin-renderer.js')
}

test('a render error in the viewer scene reaches both the immersive session and the host', async () => {
  const seen: string[] = []
  const onError = composeRenderErrorHandlers(
    (cause) => seen.push(`immersive: ${String(cause)}`),
    (cause) => seen.push(`host: ${String(cause)}`),
  )
  const original = console.error
  console.error = () => {}
  try {
    const renderer = await create(
      <ErrorBoundary fallback={null} onError={onError} scope="viewer-scene">
        <FailingRenderer />
      </ErrorBoundary>,
    )
    await renderer.unmount()
  } finally {
    console.error = original
  }
  expect(seen).toEqual([
    'immersive: Error: Failed to fetch dynamically imported module: /plugin-renderer.js',
    'host: Error: Failed to fetch dynamically imported module: /plugin-renderer.js',
  ])
  expect(composeRenderErrorHandlers(undefined, undefined)).toBeUndefined()
})

test('Viewer forwards scene render errors to its host through onRenderError', async () => {
  const source = await Bun.file(new URL('./index.tsx', import.meta.url)).text()
  // Both scene paths (immersive and plain) hand the host's handler to the scene boundary.
  expect(source.match(/onRenderError=\{composeRenderErrorHandlers\(/g)?.length).toBe(2)
  expect(source).toContain('onRenderError?: (cause: unknown) => void')
})
