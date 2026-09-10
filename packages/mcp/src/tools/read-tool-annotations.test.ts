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
      'get_level_summary',
      'get_node',
      'get_scene',
      'get_walls',
      'get_zones',
      'list_levels',
      'list_scenes',
      'list_templates',
      'measure',
      'search_assets',
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
      'add_window',
      'create_level',
      'create_project',
      'create_roof',
      'create_room',
      'create_story_shell',
      'create_wall',
      'cut_opening',
      'duplicate_level',
      'furnish_room',
      'generate_variants',
      'place_item',
      'set_zone',
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
      'create_from_template',
      'create_house_from_brief',
      'create_stair_between_levels',
      'delete_node',
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
