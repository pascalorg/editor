import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  nodeRegistry,
  registerNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { useEffect } from 'react'
import { RegisteredSystems } from './registered-systems'

let restoreRegistry: () => void
let restoreScene: ReturnType<typeof useScene.getState>

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  restoreScene = useScene.getState()
  nodeRegistry._reset()
  useScene.setState({ installedPlugins: [] })
})

afterEach(() => {
  restoreRegistry()
  useScene.setState(restoreScene, true)
})

function registerSystem(kind: string, module: NonNullable<AnyNodeDefinition['system']>['module']) {
  registerNode({ kind, schema: SlabNode, schemaVersion: 1, capabilities: {}, system: { module } })
}

test.each([
  'render',
  'effect',
  'load',
] as const)('a system failing during %s disables itself while siblings keep running without remounting', async (phase) => {
  const error = new Error(`broken system ${phase}`)
  const log = spyOn(console, 'error').mockImplementation(() => {})
  const report = spyOn(globalThis, 'reportError').mockImplementation(() => {})
  let mounts = 0
  let unmounts = 0
  let frames = 0
  function HealthySystem() {
    useEffect(() => {
      mounts++
      return () => {
        unmounts++
      }
    }, [])
    useFrame(() => {
      frames++
    })
    return <group name="healthy-system" />
  }
  function BrokenSystem() {
    useEffect(() => {
      if (phase === 'effect') throw error
    }, [])
    if (phase === 'render') throw error
    return <group name="broken-system" />
  }
  registerSystem('healthy-system', async () => ({ default: HealthySystem }))
  registerSystem('broken-system', async () => {
    if (phase === 'load') throw error
    return { default: BrokenSystem }
  })
  try {
    const renderer = await create(<RegisteredSystems />)
    try {
      expect(renderer.scene.findAllByProps({ name: 'healthy-system' })).toHaveLength(1)
      expect(renderer.scene.findAllByProps({ name: 'broken-system' })).toHaveLength(0)
      expect(
        log.mock.calls.some(
          ([message, caught]) =>
            String(message).includes('Disabled system broken-system') && caught === error,
        ),
      ).toBe(true)
      expect(mounts).toBe(1)
      await renderer.advanceFrames(1, 0.016)
      expect(frames).toBe(1)
      await renderer.update(<RegisteredSystems />)
      await act(async () => {
        useScene.setState({ installedPlugins: ['unrelated-plugin'] })
        registerSystem('late-system', async () => ({ default: () => <group name="late-system" /> }))
      })
      expect(renderer.scene.findAllByProps({ name: 'late-system' })).toHaveLength(1)
      expect(renderer.scene.findAllByProps({ name: 'broken-system' })).toHaveLength(0)
      expect(mounts).toBe(1)
      expect(unmounts).toBe(0)
      await renderer.advanceFrames(1, 0.016)
      expect(frames).toBe(2)
    } finally {
      await renderer.unmount()
    }
    expect(unmounts).toBe(1)
  } finally {
    log.mockRestore()
    report.mockRestore()
  }
})
