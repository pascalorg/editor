import { useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import {
  registerViewerPresentation,
  viewerPresentationRegistry,
  ViewerPresentations,
} from './viewer-presentations'

beforeEach(() => {
  viewerPresentationRegistry.reset()
  useScene.setState({ installedPlugins: [] })
})

afterEach(() => {
  viewerPresentationRegistry.reset()
  useScene.setState({ installedPlugins: [] })
})

test('plugin install state independently mounts, releases, and remounts each viewer presentation', async () => {
  registerViewerPresentation({
    id: 'host:grid',
    component: async () => ({ default: () => <group name="host-presentation" /> }),
  })
  registerViewerPresentation({
    id: 'acme:nature:presentation',
    pluginId: 'acme:nature',
    component: async () => ({ default: () => <group name="plugin-presentation" /> }),
  })

  const first = await create(<ViewerPresentations />)
  const second = await create(<ViewerPresentations />)
  const count = (renderer: typeof first, name: string) =>
    renderer.scene.findAllByProps({ name }).length
  let firstUnmounted = false

  try {
    expect(count(first, 'host-presentation')).toBe(1)
    expect(count(second, 'host-presentation')).toBe(1)
    expect(count(first, 'plugin-presentation')).toBe(0)

    await act(async () => {
      useScene.getState().setInstalledPlugins(['acme:nature'], { explicit: true })
    })
    expect(count(first, 'plugin-presentation')).toBe(1)
    expect(count(second, 'plugin-presentation')).toBe(1)

    await first.unmount()
    firstUnmounted = true
    expect(count(second, 'plugin-presentation')).toBe(1)

    await act(async () => {
      useScene.getState().setInstalledPlugins([], { explicit: true })
    })
    expect(count(second, 'plugin-presentation')).toBe(0)

    await act(async () => {
      useScene.getState().setInstalledPlugins(['acme:nature'], { explicit: true })
    })
    expect(count(second, 'plugin-presentation')).toBe(1)
  } finally {
    if (!firstUnmounted) await first.unmount()
    await second.unmount()
  }
})

test('a crashing lazy presentation does not remove healthy contributions', async () => {
  const originalConsoleError = console.error
  console.error = mock(() => {})
  const reportedErrors: unknown[] = []
  const report = spyOn(globalThis, 'reportError').mockImplementation((error) => {
    reportedErrors.push(error)
  })
  registerViewerPresentation({
    id: 'acme:healthy',
    component: async () => ({ default: () => <group name="healthy-presentation" /> }),
  })
  registerViewerPresentation({
    id: 'acme:broken',
    component: async () => ({
      default: () => {
        throw new Error('broken presentation')
      },
    }),
  })

  try {
    const renderer = await create(<ViewerPresentations />)
    try {
      expect(renderer.scene.findAllByProps({ name: 'healthy-presentation' })).toHaveLength(1)
      expect(
        reportedErrors.some(
          (error) => error instanceof Error && error.message === 'broken presentation',
        ),
      ).toBe(true)
    } finally {
      await renderer.unmount()
    }
  } finally {
    console.error = originalConsoleError
    report.mockRestore()
  }
})
