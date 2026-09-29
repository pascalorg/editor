import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ZoneNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSceneQueryTools } from './scene-query'

test('get_zones returns holes and the area of the outer minus holes', async () => {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
  const zone = ZoneNode.parse({
    name: 'Hall',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
    ],
  })
  bridge.createNode(zone, level.id)
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSceneQueryTools(server, bridge)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    for (const name of ['get_zones', 'get_level_summary']) {
      const result = await client.callTool({ name, arguments: { levelId: level.id } })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
      expect(parsed.zones).toEqual([
        expect.objectContaining({
          id: zone.id,
          polygon: zone.polygon,
          holes: zone.holes,
          areaSqMeters: 84,
        }),
      ])
    }
  } finally {
    await client.close()
    await server.close()
  }
})
