import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  AssemblyNode,
  BoxNode,
  BuildingNode,
  CylinderNode,
  LevelNode,
  SiteNode,
} from '@pascal-app/core'
import { SqliteSceneStore } from '../../../packages/mcp/src/storage/sqlite-scene-store'
import { apiGraphSchema, diagnoseApiGraph } from './graph-schema'

async function withTempStore<T>(fn: (store: SqliteSceneStore) => Promise<T>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-generated-save-test-'))
  const store = new SqliteSceneStore({ databasePath: path.join(root, 'pascal.db') })
  try {
    return await fn(store)
  } finally {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  }
}

function makeGeneratedPumpGraph() {
  const site = SiteNode.parse({ id: 'site_generated_save', children: ['building_generated_save'] })
  const building = BuildingNode.parse({
    id: 'building_generated_save',
    parentId: site.id,
    children: ['level_generated_save'],
  })
  const level = LevelNode.parse({
    id: 'level_generated_save',
    parentId: building.id,
    children: ['assembly_generated_pump'],
  })
  const assembly = AssemblyNode.parse({
    id: 'assembly_generated_pump',
    parentId: level.id,
    name: 'Generated pump',
    position: [0, 0, 0],
    children: ['box_pump_base', 'cylinder_pump_motor'],
    metadata: { generatedBy: 'ai-chat', sourceTool: 'compose_parts', isNew: true },
  })
  const base = BoxNode.parse({
    id: 'box_pump_base',
    parentId: assembly.id,
    name: 'pump skid base',
    position: [0, 0.05, 0],
    length: 1.4,
    width: 0.55,
    height: 0.1,
  })
  const motor = CylinderNode.parse({
    id: 'cylinder_pump_motor',
    parentId: assembly.id,
    name: 'pump motor',
    position: [-0.24, 0.34, 0],
    rotation: [0, 0, Math.PI / 2],
    radius: 0.2,
    height: 0.55,
  })

  return {
    nodes: Object.fromEntries(
      [site, building, level, assembly, base, motor].map((node) => [node.id, node]),
    ),
    rootNodeIds: [site.id],
  }
}

describe('apiGraphSchema diagnostics', () => {
  test('reports invalid generated node details by node id, type, path, and message', () => {
    const graph = makeGeneratedPumpGraph()
    graph.nodes.box_pump_base = { ...graph.nodes.box_pump_base, length: -1 }

    expect(apiGraphSchema.safeParse(graph).success).toBe(false)
    expect(diagnoseApiGraph(graph)).toContainEqual(
      expect.objectContaining({
        nodeId: 'box_pump_base',
        type: 'box',
        path: 'length',
      }),
    )
  })

  test('round-trips a generated assembly graph through scene storage', async () => {
    const graph = makeGeneratedPumpGraph()
    expect(apiGraphSchema.safeParse(graph).success).toBe(true)

    await withTempStore(async (store) => {
      await store.save({ id: 'generated-pump-scene', name: 'Generated pump scene', graph })
      const loaded = await store.load('generated-pump-scene')

      expect(loaded?.graph.nodes.assembly_generated_pump).toMatchObject({
        type: 'assembly',
        name: 'Generated pump',
      })
      expect(loaded?.graph.nodes.cylinder_pump_motor).toMatchObject({
        type: 'cylinder',
        parentId: 'assembly_generated_pump',
      })
    })
  })
})
