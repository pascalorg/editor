import { afterEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { bundledCatalog } from './bundled'
import type { AssetCatalog, CatalogSnapshot } from './types'

const connections: Array<{ client: Client; server: McpServer }> = []

afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close()
    await server.close()
  }
})

async function connect(assetCatalog: AssetCatalog) {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge, assetCatalog })
  const client = new Client({ name: 'catalog-integration-test', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  connections.push({ client, server })
  return { bridge, client }
}

function payload(result: Awaited<ReturnType<Client['callTool']>>) {
  expect(result.isError).toBeFalsy()
  return result.structuredContent as Record<string, any>
}

async function connectedSnapshot(): Promise<CatalogSnapshot> {
  const bundled = await bundledCatalog.snapshot()
  return {
    items: [
      ...bundled.items,
      {
        ...bundled.items[0]!,
        id: 'online-lounge',
        name: 'Oak lounge chair',
        src: 'https://assets.example/model.glb',
        dimensions: [0.8, 0.9, 0.85],
        category: 'furniture',
        source: 'community',
        tags: ['oak', 'living', 'seating'],
      },
    ],
    status: {
      ...bundled.status,
      mode: 'online',
      onlineCount: 1,
      message: 'Public catalog connected.',
    },
  }
}

describe('catalog discovery and placement', () => {
  test('search, resource and placement use the same connected item metadata', async () => {
    const snapshot = await connectedSnapshot()
    const { bridge, client } = await connect({ usesNetwork: true, snapshot: async () => snapshot })
    await client.listTools()
    const search = payload(
      await client.callTool({ name: 'search_assets', arguments: { query: 'oak lounge' } }),
    )
    expect(search.total).toBe(1)
    expect(search.results[0]).toMatchObject({
      id: 'online-lounge',
      source: 'online',
      dimensions: [0.8, 0.9, 0.85],
    })
    const resource = await client.readResource({ uri: 'pascal://catalog/items' })
    const listed = JSON.parse(resource.contents[0]!.text as string)
    expect(listed.catalog.mode).toBe('online')
    expect(listed.items.find((item: { id: string }) => item.id === 'online-lounge')).toEqual(
      snapshot.items.at(-1),
    )
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const placed = payload(
      await client.callTool({
        name: 'place_item',
        arguments: { catalogItemId: 'online-lounge', targetNodeId: level.id, position: [2, 0, 2] },
      }),
    )
    const node = bridge.getNode(placed.itemId as AnyNodeId)
    expect(node?.type).toBe('item')
    if (node?.type !== 'item') throw new Error('Missing placed item')
    expect(node.asset.id).toBe('online-lounge')
    expect(node.asset.src).toBe('https://assets.example/model.glb')
    expect(node.asset.dimensions).toEqual([0.8, 0.9, 0.85])
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('disconnect after search refuses the selected online item without a placeholder or mutation', async () => {
    let snapshot = await connectedSnapshot()
    const { bridge, client } = await connect({ usesNetwork: true, snapshot: async () => snapshot })
    payload(await client.callTool({ name: 'search_assets', arguments: { query: 'oak lounge' } }))
    snapshot = await bundledCatalog.snapshot()
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const before = bridge.exportJSON()
    const result = await client.callTool({
      name: 'place_item',
      arguments: { catalogItemId: 'online-lounge', targetNodeId: level.id, position: [2, 0, 2] },
    })
    expect(result.isError).toBe(true)
    expect(bridge.exportJSON()).toEqual(before)
    const local = payload(
      await client.callTool({
        name: 'place_item',
        arguments: { catalogItemId: 'sofa', targetNodeId: level.id, position: [2, 0, 2] },
      }),
    )
    expect(local.status).toBe('ok')
  })

  test('unknown IDs never create fabricated assets', async () => {
    const { bridge, client } = await connect(bundledCatalog)
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const before = bridge.exportJSON()
    const result = await client.callTool({
      name: 'place_item',
      arguments: { catalogItemId: 'imagined-model', targetNodeId: level.id, position: [1, 0, 1] },
    })
    expect(result.isError).toBe(true)
    expect(bridge.exportJSON()).toEqual(before)
  })

  test('search is bounded and preserves total matches for candidate pagination', async () => {
    const snapshot = await connectedSnapshot()
    const { client } = await connect({ usesNetwork: true, snapshot: async () => snapshot })
    const full = payload(
      await client.callTool({
        name: 'search_assets',
        arguments: { query: 'furniture', limit: 50 },
      }),
    )
    const page = payload(
      await client.callTool({
        name: 'search_assets',
        arguments: { query: 'furniture', limit: 2, offset: 1 },
      }),
    )
    expect(page.total).toBe(full.total)
    expect(page.results).toEqual(full.results.slice(1, 3))
    expect(page.catalog).toEqual(snapshot.status)
  })

  test('network-capable catalogs disclose open-world access on search and placement', async () => {
    const { client } = await connect({
      usesNetwork: true,
      snapshot: () => bundledCatalog.snapshot(),
    })
    const tools = (await client.listTools()).tools
    expect(tools.find((tool) => tool.name === 'search_assets')?.annotations?.openWorldHint).toBe(
      true,
    )
    expect(tools.find((tool) => tool.name === 'place_item')?.annotations?.openWorldHint).toBe(true)
    expect(tools.find((tool) => tool.name === 'get_node_catalog')?.annotations?.openWorldHint).toBe(
      false,
    )
  })

  test('source selection distinguishes bundled items from the public library and community', async () => {
    const snapshot = await connectedSnapshot()
    const { client } = await connect({ usesNetwork: true, snapshot: async () => snapshot })
    const community = payload(
      await client.callTool({
        name: 'search_assets',
        arguments: { query: 'furniture', source: 'community' },
      }),
    )
    expect(community.results).toHaveLength(1)
    expect(community.results[0]).toMatchObject({
      id: 'online-lounge',
      source: 'online',
      catalogSource: 'community',
    })
    const bundled = payload(
      await client.callTool({
        name: 'search_assets',
        arguments: { query: 'furniture', source: 'bundled' },
      }),
    )
    expect(bundled.results.every((item: { source: string }) => item.source === 'bundled')).toBe(
      true,
    )
    const library = payload(
      await client.callTool({
        name: 'search_assets',
        arguments: { query: 'furniture', source: 'library' },
      }),
    )
    expect(library.results).toEqual([])
  })
})
