import { expect, test } from 'bun:test'
import { type PersistedSceneGraph, sceneGraphSignature } from './scene-signature'

const NODE_ID = 'level_a1b2c3d4e5f6g7h8'
const MATERIAL_ID = 'mat_a1b2c3d4e5f6g7h8'
const DEFINITION_ID = 'definition_balcony'

const graph = (overrides: Partial<PersistedSceneGraph> = {}) =>
  ({
    nodes: { [NODE_ID]: { object: 'node', id: NODE_ID, type: 'level', level: 0 } },
    rootNodeIds: [NODE_ID],
    ...overrides,
  }) as PersistedSceneGraph

// The echo check compares a raw SSE payload against the store after
// `setScene` ran, and `setScene` always writes these three keys. A payload
// that omits them — which is exactly what MCP live sync sends — must still
// match, or every remote update looks like a local edit and gets saved back.
test('an omitted field signs the same as its applied default', () => {
  expect(sceneGraphSignature(graph())).toBe(
    sceneGraphSignature(
      graph({ collections: {}, definitions: {}, materials: {}, installedPlugins: [] }),
    ),
  )
})

// Conversely, every field the save body carries has to be signed. An unsigned
// field makes a local edit that touches only that field read as an echo, and
// the save is skipped — the change is silently lost.
test('changing any signed field changes the signature', () => {
  const base = sceneGraphSignature(graph())

  expect(
    sceneGraphSignature(
      graph({ materials: { [MATERIAL_ID]: { id: MATERIAL_ID, name: 'Oak', material: {} } } }),
    ),
  ).not.toBe(base)
  expect(
    sceneGraphSignature(graph({ collections: { col_1: { id: 'col_1', nodeIds: [] } } })),
  ).not.toBe(base)
  expect(
    sceneGraphSignature(
      graph({
        definitions: {
          [DEFINITION_ID]: {
            id: DEFINITION_ID,
            name: 'Balcony A',
            rootNodeId: NODE_ID,
          },
        },
      }),
    ),
  ).not.toBe(base)
  expect(sceneGraphSignature(graph({ installedPlugins: ['@pascal-app/plugin-trees'] }))).not.toBe(
    base,
  )
})
