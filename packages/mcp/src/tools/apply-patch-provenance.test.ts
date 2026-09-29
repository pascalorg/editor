import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PROVENANCE_MAX_REFS, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerApplyPatch } from './apply-patch'

/**
 * Over-cap `provenance` through `apply_patch` (EC-I01, D5). The core store
 * refuses the write, so a single update stores nothing. Refusing a mixed
 * patch before any of its ops applies is the tool layer's dry run
 * (`patch-guards.ts`, pascalorg/editor#938); that case runs once it exists.
 */
const OVER_CAP = {
  refs: Array.from({ length: PROVENANCE_MAX_REFS + 1 }, (_, i) => ({ ns: 'al', id: `s-${i}` })),
}
const PATCH_GUARDS = existsSync(new URL('./patch-guards.ts', import.meta.url))

describe('apply_patch and typed provenance', () => {
  let client: Client
  let bridge: SceneBridge
  let wallId: string

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      provenance: { refs: [{ ns: 'al', id: 'ground-exterior-01' }] },
    })
    wallId = wall.id
    bridge.applyPatch([{ op: 'create', node: wall, parentId: level.id }])
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerApplyPatch(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  const provenanceOf = (id: string) =>
    (bridge.getNode(id as never) as { provenance?: unknown })?.provenance

  test('an over-cap provenance update is refused and stores nothing', async () => {
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'update', id: wallId, data: { provenance: OVER_CAP } }] },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('provenance')
    expect(provenanceOf(wallId)).toEqual({ refs: [{ ns: 'al', id: 'ground-exterior-01' }] })
  })

  test.skipIf(!PATCH_GUARDS)(
    'a mixed patch with an over-cap update applies none of its ops',
    async () => {
      const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
      const extra = WallNode.parse({ start: [0, 2], end: [5, 2] })
      const result = await client.callTool({
        name: 'apply_patch',
        arguments: {
          patches: [
            { op: 'create', node: extra, parentId: level.id },
            { op: 'update', id: wallId, data: { provenance: OVER_CAP } },
          ],
        },
      })
      expect(result.isError).toBe(true)
      expect(bridge.getNode(extra.id)).toBeNull()
      expect(provenanceOf(wallId)).toEqual({ refs: [{ ns: 'al', id: 'ground-exterior-01' }] })
    },
  )
})
