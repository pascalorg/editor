import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  DoorNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
} from '@pascal-app/core'
import * as THREE from 'three'
import { nodesAwaitingExportGeometry, waitForExportGeometry } from './glb-export'

const node = (id: string, type: string, fields: Record<string, unknown> = {}) =>
  ({
    object: 'node',
    id,
    type,
    parentId: 'level_a',
    visible: true,
    metadata: {},
    ...fields,
  }) as unknown as AnyNode

const definition = (kind: string, extra: Record<string, unknown> = {}) =>
  ({
    kind,
    schemaVersion: 1,
    schema: DoorNode,
    category: 'utility',
    defaults: () => ({}) as never,
    capabilities: {},
    bake: 'replace',
    ...extra,
  }) as AnyNodeDefinition

let restoreRegistry: () => void

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  registerNode(definition('test:plant'))
  registerNode(definition('test:baked', { bakeGeometry: () => new THREE.Group() }))
})

afterEach(() => {
  restoreRegistry()
  sceneRegistry.clear()
})

// Live objects as the editor registers them: still empty, i.e. the export
// geometry has not mounted.
function mount(ids: string[]) {
  for (const id of ids) sceneRegistry.nodes.set(id, new THREE.Group())
}

describe('waitForExportGeometry', () => {
  const nodes: Record<string, AnyNode> = {
    level_a: node('level_a', 'level', { parentId: null }),
    plant_a: node('plant_a', 'test:plant'),
    plant_hidden: node('plant_hidden', 'test:plant', { visible: false }),
    baked_a: node('baked_a', 'test:baked'),
  }

  test('waits only for included collective kinds that mount their own geometry', () => {
    mount(['plant_a', 'plant_hidden', 'baked_a'])
    expect(nodesAwaitingExportGeometry(nodes)).toEqual(['plant_a'])
    expect(nodesAwaitingExportGeometry(nodes, { onlyVisible: false })).toEqual([
      'plant_a',
      'plant_hidden',
    ])
    expect(nodesAwaitingExportGeometry(nodes, { excludedNodeTypes: ['test:plant'] })).toEqual([])
    sceneRegistry.nodes.get('plant_a')!.add(new THREE.Mesh())
    expect(nodesAwaitingExportGeometry(nodes)).toEqual([])
  })

  test('times out on its own timer when geometry never mounts and frames never run', async () => {
    mount(['plant_a'])
    const started = Date.now()
    await waitForExportGeometry(nodes, {}, 300)
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(280)
    expect(elapsed).toBeLessThan(1500)
  })

  test('returns as soon as nothing is pending', async () => {
    mount(['plant_a', 'baked_a'])
    const started = Date.now()
    await waitForExportGeometry(nodes, { excludedNodeTypes: ['test:plant'] }, 5_000)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
