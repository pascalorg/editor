import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import useEditor from '../store/use-editor'
import { useStickyDefaults } from '../store/use-sticky-defaults'
import { stickyParamsOf } from './use-sticky-tool-defaults'

const STICKY_KIND = 'sticky-test-wall'

function registerStickyTestKind() {
  if (nodeRegistry.has(STICKY_KIND)) return

  registerNode({
    kind: STICKY_KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(STICKY_KIND) }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: { selectable: {}, stickyParams: ['thickness', 'height'] },
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

function node(extra: Record<string, unknown>): AnyNode {
  return { id: 'n1', type: STICKY_KIND, position: [1, 2, 3], ...extra } as unknown as AnyNode
}

describe('stickyParamsOf', () => {
  beforeAll(registerStickyTestKind)

  test('keeps only the keys the kind declares sticky', () => {
    expect(stickyParamsOf(node({ thickness: 0.25, height: 2.4, start: [0, 0] }))).toEqual({
      thickness: 0.25,
      height: 2.4,
    })
  })

  test('skips keys the instance leaves unset rather than pinning them to undefined', () => {
    expect(stickyParamsOf(node({ thickness: 0.25 }))).toEqual({ thickness: 0.25 })
  })

  test('a kind with no sticky params contributes nothing', () => {
    expect(stickyParamsOf({ id: 'x', type: 'level' } as unknown as AnyNode)).toBeNull()
  })

  test('an unregistered kind contributes nothing', () => {
    expect(stickyParamsOf({ id: 'x', type: 'not-a-kind' } as unknown as AnyNode)).toBeNull()
  })
})

describe('sticky memory feeds the next activation', () => {
  beforeAll(registerStickyTestKind)

  beforeEach(() => {
    useEditor.setState({ toolDefaults: {}, tool: null })
    useStickyDefaults.setState({ lastUsedParams: {} })
  })

  test('setTool seeds tool defaults from what the kind was last used at', () => {
    useStickyDefaults.getState().remember(STICKY_KIND, { thickness: 0.25 })
    useEditor.getState().setTool(STICKY_KIND as never)

    expect(useEditor.getState().toolDefaults[STICKY_KIND as never]).toEqual({ thickness: 0.25 })
  })

  test('an entry staged by the caller wins — a preset outranks the memory', () => {
    useStickyDefaults.getState().remember(STICKY_KIND, { thickness: 0.25 })
    useEditor.getState().setToolDefaults(STICKY_KIND as never, { thickness: 0.4 })
    useEditor.getState().setTool(STICKY_KIND as never)

    expect(useEditor.getState().toolDefaults[STICKY_KIND as never]).toEqual({ thickness: 0.4 })
  })

  test('later edits merge into the memory instead of replacing it', () => {
    useStickyDefaults.getState().remember(STICKY_KIND, { thickness: 0.25 })
    useStickyDefaults.getState().remember(STICKY_KIND, { height: 2.4 })

    expect(useStickyDefaults.getState().lastUsedParams[STICKY_KIND]).toEqual({
      thickness: 0.25,
      height: 2.4,
    })
  })

  test('a kind that was never used leaves tool defaults empty', () => {
    useEditor.getState().setTool(STICKY_KIND as never)

    expect(useEditor.getState().toolDefaults[STICKY_KIND as never]).toBeUndefined()
  })

  test('re-remembering the same values does not churn the store', () => {
    useStickyDefaults.getState().remember(STICKY_KIND, { thickness: 0.25 })
    const first = useStickyDefaults.getState().lastUsedParams
    useStickyDefaults.getState().remember(STICKY_KIND, { thickness: 0.25 })

    expect(useStickyDefaults.getState().lastUsedParams).toBe(first)
  })
})
