import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AnyNodeId, WallNode } from '@pascal-app/core'
import type { SceneOperations } from '../../operations'
import { registerCreateProject } from './create-project'
import { registerGetProjectStatus } from './get-project-status'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './test-utils'

describe('project lifecycle tools', () => {
  let client: Client
  let store: InMemorySceneStore
  let operations: SceneOperations

  beforeEach(async () => {
    store = new InMemorySceneStore()
    ;({ operations } = createTestSceneOperations({ store }))
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCreateProject(server, operations)
    registerGetProjectStatus(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a project and returns an editor URL', async () => {
    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'Dogfood house' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.name).toBe('Dogfood house')
    expect(typeof parsed.projectId).toBe('string')
    expect(parsed.editorUrl).toBe(`/editor/${parsed.projectId}`)
    expect(parsed.nextStep).toContain('save_scene')
  })

  // A project made in one session answered scene_not_found to load_scene from any
  // other until its first save; an agent whose session reset could not open it again.
  test('a new project is a saved scene at once, loadable from any session', async () => {
    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'Fresh house' },
    })
    const parsed = parseToolText(result.content as StoredTextContent[])
    const elsewhere = createTestSceneOperations({ store }).operations
    const scene = await elsewhere.loadStoredScene(parsed.projectId as string)
    expect(scene).not.toBeNull()
    expect(Object.keys(scene!.graph.nodes).length).toBe(parsed.nodeCount as number)
    expect(parsed.nodeCount).toBeGreaterThan(0)
  })

  test('reports status for an existing project', async () => {
    const project = await store.createProject({ name: 'Status house' })
    const result = await client.callTool({
      name: 'get_project_status',
      arguments: { id: project.projectId },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.projectId).toBe(project.projectId)
    expect(parsed.editorUrl).toBe(`/editor/${project.projectId}`)
    expect(parsed.nodeCount).toBe(0)
  })

  // 2026-10-03, a Claude Code run on :3101: create_project in a session bound to another project
  // returned that project's levels, and the next save would have written it into the new one.
  const withAWall = () => {
    operations.loadDefault()
    const level = Object.values(operations.getNodes()).find((node) => node.type === 'level')!
    operations.createNode(
      WallNode.parse({ start: [0, 0], end: [4, 0] }) as never,
      level.id as AnyNodeId,
    )
    return level.id
  }
  const walls = () => Object.values(operations.getNodes()).filter((node) => node.type === 'wall')

  test('a session bound to another project starts the new one on an empty scene', async () => {
    const other = await store.createProject({ name: 'Hawkesbury' })
    const otherLevel = withAWall()
    operations.setActiveScene({
      id: other.id,
      name: other.name,
      projectId: other.projectId,
      ownerId: other.ownerId,
      thumbnailUrl: other.thumbnailUrl,
      version: other.version,
    })
    const result = await client.callTool({
      name: 'create_project',
      arguments: { name: 'The Victor' },
    })
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.levelIds).not.toContain(otherLevel)
    expect(walls()).toHaveLength(0)
    expect(operations.getHistory().pastCount).toBe(0)
  })

  test('work not bound to any project becomes the new project', async () => {
    withAWall()
    const before = walls().length
    await client.callTool({ name: 'create_project', arguments: { name: 'Built first' } })
    expect(walls().length).toBe(before)
    expect(before).toBeGreaterThan(0)
  })
})
