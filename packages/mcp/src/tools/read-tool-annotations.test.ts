import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import {
  AGENT_TOOL_CONTRACTS,
  type AgentToolContract,
  designBriefTool,
  HOSTED_SERVICE_TOOL_CONTRACTS,
  PROJECT_FILE_TOOL_CONTRACTS,
  surfaceDescription,
  viewSceneTool,
} from '@pascal-app/core/agent-tools'
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
      'export_glb',
      'export_json',
      'find_by_type',
      'get_level_summary',
      'get_node',
      'get_scene',
      'get_site',
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
      'search_materials',
      'validate_design',
      'verify_scene',
      'view_assets',
      'view_scene',
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
      'add_corner_window',
      'add_door',
      'add_fence',
      'add_level',
      'add_wall',
      'add_window',
      'create_mezzanine',
      'create_project',
      'create_roof',
      'create_room',
      'create_stair',
      'design_brief',
      'set_checkpoint',
      'create_story_shell',
      'create_unit',
      'cut_floor_opening',
      'duplicate_level',
      'duplicate_node',
      'furnish_room',
      'place_in_room',
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
      'clear_scene',
      'add_object',
      'author_scene',
      'add_column',
      'set_wall_type',
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
      'move_node',
      'move_zone',
      'place_building',
      'rotate_zone',
      'lock_outside_faces',
      'merge_windows',
      'merge_zones',
      'move_roofs_to_roof_level',
      'paint',
      'delete_scene',
      'get_project_status',
      'load_scene',
      'redo',
      'set_ground_level',
      'set_unit_members',
      'rename_scene',
      'run_batch',
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

// A shared tool's description is true on every surface; what only the MCP does (who renders a
// view, how long a brief lasts) is the contract's MCP note, which only the MCP lists.
describe('MCP tool descriptions', () => {
  test('list each shared tool with its contract text and the MCP note, never the chat note', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-descriptions-'))
    const store = new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') })
    // The hosted service and file tools register only with their executors; listing calls neither.
    const unused = async () => {
      throw new Error('not used while listing tools')
    }
    const server = createPascalMcpServer({ bridge, store, services: unused, files: unused })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'description-test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const listed = new Map(
        (await client.listTools()).tools.map((tool) => [tool.name, tool.description ?? '']),
      )
      const shared: readonly AgentToolContract[] = [
        ...AGENT_TOOL_CONTRACTS,
        ...HOSTED_SERVICE_TOOL_CONTRACTS,
        ...PROJECT_FILE_TOOL_CONTRACTS,
      ]
      for (const contract of shared) {
        const description = listed.get(contract.name) ?? ''
        const { mcp: note, ...otherNotes } = contract.surfaceNotes ?? {}
        // From the contract's own fields, not through the helper the server registers with.
        expect({
          tool: contract.name,
          listed: listed.has(contract.name),
          startsWithShared: description.startsWith(contract.description),
          endsWithNote: note ? description.endsWith(note) : description === contract.description,
          otherNotes: Object.values(otherNotes).filter((other) => description.includes(other)),
        }).toEqual({
          tool: contract.name,
          listed: true,
          startsWithShared: true,
          endsWithNote: true,
          otherNotes: [],
        })
        expect({ tool: contract.name, description }).toEqual({
          tool: contract.name,
          description: surfaceDescription(contract, 'mcp'),
        })
      }
      expect(listed.get(viewSceneTool.name)).toContain('editor_tab_required')
      expect(listed.get(designBriefTool.name)).toContain('A brief lasts for the session.')
      expect(listed.get(designBriefTool.name)).not.toContain(designBriefTool.surfaceNotes.chat)
    } finally {
      await client.close()
      await server.close()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
