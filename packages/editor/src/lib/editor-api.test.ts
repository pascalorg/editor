import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { z } from 'zod'
import useEditor from '../store/use-editor'
import { createEditorApi } from './editor-api'

function registerAffordanceTestNode() {
  const kind = 'editor-api-affordance-test'
  if (nodeRegistry.has(kind)) return kind
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ id: z.string(), type: z.literal(kind) }) as never,
    category: 'structure',
    defaults: () => ({ id: 'node_1', type: kind }) as never,
    capabilities: {},
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    affordanceTools: {
      'bend-route': async () => ({ default: () => null }),
      'drag-port': async () => ({ default: () => null }),
    },
    actionMenu: {
      curve: { affordance: 'bend-route' },
      endpointMove: {
        affordance: 'drag-port',
        label: () => ({ fallback: 'Move port' }),
        localPosition: () => [0, 0, 0],
      },
    },
  } as AnyNodeDefinition)
  return kind
}

describe('createEditorApi', () => {
  beforeEach(() => {
    useEditor.getState().setActiveAffordance(null)
  })

  test('activates curve tools through registry affordance metadata', () => {
    const kind = registerAffordanceTestNode()
    const node = { id: 'curve_1', type: kind } as unknown as AnyNode

    createEditorApi().engageCurve(node)

    expect(useEditor.getState().activeAffordance).toMatchObject({
      node,
      affordance: 'bend-route',
      props: { node },
    })
  })

  test('activates endpoint tools through registry affordance metadata', () => {
    const kind = registerAffordanceTestNode()
    const node = { id: 'endpoint_1', type: kind } as unknown as AnyNode

    createEditorApi().engageEndpointMove(node, 'end')

    const active = useEditor.getState().activeAffordance
    expect(active?.node).toBe(node)
    expect(active?.affordance).toBe('drag-port')
    expect(active?.props.endpoint).toBe('end')
    expect(active?.props.node).toBe(node)
    expect((active?.props.target as { node?: AnyNode; endpoint?: string })?.node).toBe(node)
    expect((active?.props.target as { node?: AnyNode; endpoint?: string })?.endpoint).toBe('end')
  })
})
