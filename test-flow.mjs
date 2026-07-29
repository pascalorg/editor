// Side-effect import MUST come first: installs RAF polyfill before core loads.
import './packages/mcp/src/bridge/node-shims.js'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from './packages/mcp/src/bridge/scene-bridge.js'
import { registerRoomTools } from './packages/mcp/src/tools/room-tools.js'
import { registerApplyPatch } from './packages/mcp/src/tools/apply-patch.js'

async function spinUp() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerRoomTools(server, bridge)
  registerApplyPatch(server, bridge)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server, bridge }
}

function resetScene() {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
}

async function testFullFlow() {
  resetScene()
  const { client, server, bridge } = await spinUp()
  
  try {
    // 1. Create a room
    const nodes = bridge.getNodes()
    const level = Object.values(nodes).find((n) => n.type === 'level')
    if (!level) {
      console.log('ERROR: No level found')
      return
    }
    console.log('Level found:', level.id)
    
    const roomResult = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Bedroom',
        polygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
      },
    })
    console.log('create_room result:', roomResult.isError ? 'ERROR' : 'OK')
    if (roomResult.isError) {
      console.log('Error:', roomResult.content)
      return
    }
    const room = JSON.parse(roomResult.content[0].text)
    console.log('Room created:', room)
    
    // 2. Add a door
    const wallId = room.wallIds[0]
    console.log('Adding door to wall:', wallId)
    const doorResult = await client.callTool({
      name: 'add_door',
      arguments: { wallId, t: 0.5, width: 0.9, height: 2.1 },
    })
    console.log('add_door result:', doorResult.isError ? 'ERROR' : 'OK')
    if (doorResult.isError) {
      console.log('Error:', doorResult.content)
      return
    }
    const door = JSON.parse(doorResult.content[0].text)
    console.log('Door created:', door)
    
    // 3. Add a window
    const windowResult = await client.callTool({
      name: 'add_window',
      arguments: { wallId: room.wallIds[2], t: 0.5, width: 1.5, height: 1.5, sillHeight: 0.9 },
    })
    console.log('add_window result:', windowResult.isError ? 'ERROR' : 'OK')
    if (windowResult.isError) {
      console.log('Error:', windowResult.content)
      return
    }
    const window = JSON.parse(windowResult.content[0].text)
    console.log('Window created:', window)
    
    // 4. Furnish the room
    const furnishResult = await client.callTool({
      name: 'furnish_room',
      arguments: {
        zoneId: room.zoneId,
        roomType: 'bedroom',
        doorWallIndex: 0,
      },
    })
    console.log('furnish_room result:', furnishResult.isError ? 'ERROR' : 'OK')
    if (furnishResult.isError) {
      console.log('Error:', furnishResult.content)
      return
    }
    const furnish = JSON.parse(furnishResult.content[0].text)
    console.log('Furnished:', furnish)
    
    // 5. Validate scene
    const validation = bridge.validateScene()
    console.log('Scene valid:', validation.valid)
    if (!validation.valid) {
      console.log('Validation errors:', validation.errors)
    }
    
    console.log('\n✅ Full flow test PASSED!')
  } finally {
    await client.close()
    await server.close()
  }
}

testFullFlow().catch(console.error)
