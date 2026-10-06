import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'

const TOOL_POLICIES = [
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    tools: [
      'check_collisions',
      'describe_node',
      'export_glb',
      'export_json',
      'find_nodes',
      'find_by_type',
      'get_level_summary',
      'get_node',
      'get_scene',
      'get_walls',
      'get_zones',
      'list_levels',
      'list_scenes',
      'list_templates',
      'list_units',
      'measure',
      'measure_stair',
      'get_source',
      'list_collections',
      'search_assets',
      'validate_design',
      'validate_scene',
      'verify_scene',
    ],
  },
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    tools: ['analyze_floorplan_image', 'analyze_room_photo'],
  },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    tools: [
      'add_door',
      'add_level',
      'add_wall',
      'add_window',
      'create_mezzanine',
      'create_project',
      'create_roof',
      'create_room',
      'create_stair',
      'create_story_shell',
      'create_unit',
      'cut_floor_opening',
      'duplicate_level',
      'furnish_room',
      'generate_variants',
      'place_design',
      'place_items',
      'set_zone',
      'set_zone_intent',
      'set_floor_foundation',
      'set_room_floor_construction',
    ],
  },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    tools: [
      'apply_patch',
      'add_object',
      'add_column',
      'edit_collection',
      'create_from_template',
      'create_house_from_brief',
      'delete_node',
      'fit_stair',
      'remove_floor_opening',
      'rebase_floor_reference',
      'delete_zone',
      'divide_zone',
      'duplicate_zone',
      'move_zone',
      'rotate_zone',
      'lock_outside_faces',
      'merge_zones',
      'delete_scene',
      'get_project_status',
      'load_scene',
      'redo',
      'rename_scene',
      'save_scene',
      'undo',
    ],
  },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    tools: ['set_unit_members'],
  },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    tools: ['photo_to_scene'],
  },
] as const

const EXPECTED_TOOL_NAMES = TOOL_POLICIES.flatMap(({ tools }) => tools).toSorted()
const annotationPacket = JSON.parse(
  readFileSync(
    resolve(import.meta.dir, '../../../../plugin-evals/tool-annotation-justifications.json'),
    'utf8',
  ),
) as {
  required_hints: Array<'readOnlyHint' | 'destructiveHint' | 'openWorldHint'>
  tools: Array<{
    name: string
    annotations: Record<'readOnlyHint' | 'destructiveHint' | 'openWorldHint', boolean>
    justifications: Record<'readOnlyHint' | 'destructiveHint' | 'openWorldHint', string>
  }>
}

describe('MCP tool annotations', () => {
  test('classifies every registered tool for approval-aware clients', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-annotations-'))
    const store = new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') })
    const server = createPascalMcpServer({ bridge, store })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'annotation-test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const listed = await client.listTools()
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]))
      expect([...byName.keys()].toSorted()).toEqual(EXPECTED_TOOL_NAMES)

      for (const policy of TOOL_POLICIES) {
        for (const name of policy.tools) {
          expect(byName.get(name)?.annotations).toEqual(policy.annotations)
        }
      }

      expect(annotationPacket.tools.map(({ name }) => name)).toEqual(EXPECTED_TOOL_NAMES)
      for (const tool of annotationPacket.tools) {
        const registeredAnnotations = byName.get(tool.name)?.annotations
        for (const hint of annotationPacket.required_hints) {
          expect(tool.annotations[hint]).toBe(registeredAnnotations?.[hint])
          expect(tool.justifications[hint].trim().length).toBeGreaterThan(0)
        }
      }
    } finally {
      await client.close()
      await server.close()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

// 2026-10-03, a Claude Code run on the hosted MCP: the client left out 9 tools (divide_zone,
// merge_zones, create_mezzanine…) whose input schemas held tuples, `items: [...]`. A pair is one
// `items` schema with minItems and maxItems, as Vec2Schema writes it.
describe('MCP tool input schemas', () => {
  test('hold no tuple, so every client can call every tool', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-schemas-'))
    const store = new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') })
    const server = createPascalMcpServer({ bridge, store })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'schema-test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const tuples = (schema: unknown, path: string): string[] => {
        if (!schema || typeof schema !== 'object') return []
        const record = schema as Record<string, unknown>
        const own = Array.isArray(record.items) || 'prefixItems' in record ? [path] : []
        return [
          ...own,
          ...Object.entries(record).flatMap(([key, value]) =>
            Array.isArray(value)
              ? value.flatMap((entry, index) => tuples(entry, `${path}.${key}[${index}]`))
              : tuples(value, `${path}.${key}`),
          ),
        ]
      }
      const listed = await client.listTools()
      const found = listed.tools.flatMap((tool) => tuples(tool.inputSchema, tool.name))
      expect(found).toEqual([])
    } finally {
      await client.close()
      await server.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
