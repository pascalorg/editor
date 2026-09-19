import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { type AnyNodeDefinition, nodeRegistry } from '@pascal-app/core'
import { getRegistryAffordanceTool, preloadRegistryAffordanceTools } from './affordance-dispatch'

const get = spyOn(nodeRegistry, 'get')
afterEach(() => get.mockReset())
afterAll(() => get.mockRestore())

test('a preloaded drag tool mounts directly without first-gesture suspense', async () => {
  const Tool = () => null
  const loader = async () => ({ default: Tool })
  get.mockReturnValue({ affordanceTools: { move: loader } } as unknown as AnyNodeDefinition)
  await preloadRegistryAffordanceTools('wall')
  expect(getRegistryAffordanceTool('wall', 'move')).toBe(Tool)
  expect(getRegistryAffordanceTool('wall', 'move')).toBe(Tool)
})

test('preloading does not change an already mounted lazy component identity', async () => {
  const loader = async () => ({ default: () => null })
  get.mockReturnValue({ affordanceTools: { move: loader } } as unknown as AnyNodeDefinition)
  const mounted = getRegistryAffordanceTool('wall', 'move')
  await preloadRegistryAffordanceTools('wall')
  expect(getRegistryAffordanceTool('wall', 'move')).toBe(mounted)
})
