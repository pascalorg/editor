import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AnyNode,
  type AnyNodeId,
  ColumnNode,
  DoorNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { registerApplyPatch } from './apply-patch'

type Patch = Record<string, unknown>

describe('apply_patch identity and validation guards', () => {
  let client: Client
  let bridge: SceneBridge
  let level: AnyNode

  async function apply(patches: Patch[]) {
    const result = await client.callTool({ name: 'apply_patch', arguments: { patches } })
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    return { isError: result.isError === true, text }
  }

  /** A refusal is a tool error whose text is JSON: { code, patchIndex, id, message }. */
  async function refusal(patches: Patch[]) {
    const { isError, text } = await apply(patches)
    expect(isError).toBe(true)
    return JSON.parse(text) as { code: string; patchIndex: number; id: string; message: string }
  }

  async function wallWithWindow(id = 'wall_host', start = [0, 0], end = [6, 0]) {
    const wall = WallNode.parse({ id, start, end })
    const window = WindowNode.parse({ wallId: wall.id, position: [2, 1.2, 0] })
    const seeded = await apply([
      { op: 'create', node: wall, parentId: level.id },
      { op: 'create', node: window, parentId: wall.id },
    ])
    expect(seeded.isError).toBe(false)
    return { wall, window }
  }

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    // The tool layer is what the hosted server shares; drive it through the facade.
    registerApplyPatch(server, createSceneOperations({ bridge }))
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('a children update cannot detach a node so a later create overwrites it', async () => {
    const { wall, window } = await wallWithWindow()
    const other = WallNode.parse({ start: [0, 3], end: [6, 3] })
    await apply([{ op: 'create', node: other, parentId: level.id }])

    const result = await apply([
      { op: 'update', id: wall.id, data: { children: [] } },
      { op: 'delete', id: wall.id, cascade: true },
      {
        op: 'create',
        node: WindowNode.parse({ id: window.id, wallId: other.id, position: [4, 1, 0] }),
        parentId: other.id,
      },
    ])
    expect(result.isError).toBe(true)
    expect(result.text).toContain('immutable_field')
    const kept = bridge.getNode(window.id as AnyNodeId)
    expect(kept?.type === 'window' && [kept.parentId, kept.position]).toEqual([
      wall.id,
      [2, 1.2, 0],
    ])
  })

  test('the dry run sees walls the real delete merges away', async () => {
    // Deleting the spur leaves two collinear walls meeting at [2, 0]; the core
    // delete merges them and removes the secondary one.
    const a = WallNode.parse({ id: 'wall_a', start: [0, 0], end: [2, 0] })
    const b = WallNode.parse({ id: 'wall_b', start: [2, 0], end: [4, 0] })
    const spur = WallNode.parse({ id: 'wall_spur', start: [2, 0], end: [2, 2] })
    await apply([a, b, spur].map((node) => ({ op: 'create', node, parentId: level.id })))

    const result = await apply([
      { op: 'delete', id: spur.id },
      { op: 'update', id: b.id, data: { thickness: 0.3 } },
    ])
    expect(result.isError).toBe(true)
    expect(result.text).toContain(`update id "${b.id}" not found`)
    expect(bridge.getNode(spur.id as AnyNodeId)).not.toBeNull()
    expect(bridge.getNode(b.id as AnyNodeId)).not.toBeNull()
  })

  test('consecutive deletes are planned as one batch, like the store applies them', async () => {
    const a = WallNode.parse({ id: 'wall_a', start: [0, 0], end: [2, 0] })
    const b = WallNode.parse({ id: 'wall_b', start: [2, 0], end: [4, 0] })
    const spur = WallNode.parse({ id: 'wall_spur', start: [2, 0], end: [2, 2] })
    await apply([a, b, spur].map((node) => ({ op: 'create', node, parentId: level.id })))

    // One deleteNodes([spur, b]) call: with b going too, nothing merges into a.
    const result = await apply([
      { op: 'delete', id: spur.id },
      { op: 'delete', id: b.id },
    ])
    expect(result.isError).toBe(false)
    expect(bridge.getNode(b.id as AnyNodeId)).toBeNull()
    const kept = bridge.getNode(a.id as AnyNodeId)
    expect(kept?.type === 'wall' && kept.end).toEqual([2, 0])

    // A child listed after its host in the same run is accepted, as the store does.
    const { wall, window } = await wallWithWindow()
    const nested = await apply([
      { op: 'delete', id: wall.id, cascade: true },
      { op: 'delete', id: window.id },
    ])
    expect(nested.isError).toBe(false)
    expect(bridge.getNode(window.id as AnyNodeId)).toBeNull()
  })

  test('the real cascade frees ids so a subtree can be deleted and recreated', async () => {
    const { wall, window } = await wallWithWindow()
    const result = await apply([
      { op: 'delete', id: wall.id, cascade: true },
      {
        op: 'create',
        node: WallNode.parse({ id: wall.id, start: [0, 5], end: [4, 5] }),
        parentId: level.id,
      },
      {
        op: 'create',
        node: WindowNode.parse({ id: window.id, wallId: wall.id, position: [1, 1, 0] }),
        parentId: wall.id,
      },
    ])
    expect(result.isError).toBe(false)
    const stored = bridge.getNode(window.id as AnyNodeId)
    expect(stored?.type === 'window' && stored.position).toEqual([1, 1, 0])
  })

  test('a second create of the same id in one patch is refused atomically', async () => {
    const first = WallNode.parse({ id: 'wall_twice', start: [0, 0], end: [1, 0] })
    const second = WallNode.parse({ id: 'wall_twice', start: [0, 1], end: [1, 1] })
    const result = await apply([
      { op: 'create', node: first, parentId: level.id },
      { op: 'create', node: second, parentId: level.id },
    ])
    expect(result.isError).toBe(true)
    expect(result.text).toContain('node_exists: patches[1]')
    expect(bridge.getNode(first.id as AnyNodeId)).toBeNull()
  })

  test('a node created earlier in the patch cannot change type', async () => {
    const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
    const result = await apply([
      { op: 'create', node: wall, parentId: level.id },
      { op: 'update', id: wall.id, data: { type: 'fence' } },
    ])
    expect(result.isError).toBe(true)
    expect(result.text).toContain('identity_change: patches[1]')
    expect(bridge.getNode(wall.id as AnyNodeId)).toBeNull()
  })

  test('a cascade also removes children created earlier in the same patch', async () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
    const window = WindowNode.parse({ wallId: wall.id, position: [2, 1.2, 0] })
    const result = await apply([
      { op: 'create', node: wall, parentId: level.id },
      { op: 'create', node: window, parentId: wall.id },
      { op: 'delete', id: wall.id, cascade: true },
      {
        op: 'create',
        node: WallNode.parse({ id: wall.id, start: [0, 2], end: [4, 2] }),
        parentId: level.id,
      },
      {
        op: 'create',
        node: WindowNode.parse({ id: window.id, wallId: wall.id, position: [1, 1.2, 0] }),
        parentId: wall.id,
      },
    ])
    expect(result.isError).toBe(false)
    const stored = bridge.getNode(window.id as AnyNodeId)
    expect(stored?.type === 'window' && stored.position).toEqual([1, 1.2, 0])
  })

  test('a host created without a children array still cascades to its new children', async () => {
    // A raw payload without `children`: the store parses it and starts an
    // empty list, so the child created next is removed with it.
    const rawWall = { object: 'node', type: 'wall', id: 'wall_raw', start: [0, 0], end: [4, 0] }
    const window = WindowNode.parse({ wallId: rawWall.id, position: [2, 1.2, 0] })
    const result = await apply([
      { op: 'create', node: rawWall, parentId: level.id },
      { op: 'create', node: window, parentId: rawWall.id },
      { op: 'delete', id: rawWall.id, cascade: true },
      {
        op: 'create',
        node: WindowNode.parse({ id: window.id, position: [1, 1.2, 0] }),
        parentId: level.id,
      },
    ])
    expect(result.isError).toBe(false)
    const stored = bridge.getNode(window.id as AnyNodeId)
    expect(stored?.type === 'window' && [stored.parentId, stored.position]).toEqual([
      level.id,
      [1, 1.2, 0],
    ])
  })

  test('a node reparented earlier in the patch survives its old parent’s delete', async () => {
    const { wall, window } = await wallWithWindow()
    const other = WallNode.parse({ start: [0, 3], end: [6, 3] })
    await apply([{ op: 'create', node: other, parentId: level.id }])
    const move = { op: 'update', id: window.id, data: { parentId: other.id, wallId: other.id } }

    const clash = await apply([
      move,
      { op: 'delete', id: wall.id, cascade: true },
      {
        op: 'create',
        node: WindowNode.parse({ id: window.id, wallId: other.id, position: [4, 1.2, 0] }),
        parentId: other.id,
      },
    ])
    expect(clash.isError).toBe(true)
    expect(clash.text).toContain('node_exists: patches[2]')

    const edit = await apply([
      move,
      { op: 'delete', id: wall.id, cascade: true },
      { op: 'update', id: window.id, data: { width: 1.1 } },
    ])
    expect(edit.isError).toBe(false)
    const moved = bridge.getNode(window.id as AnyNodeId)
    expect(moved?.type === 'window' && [moved.parentId, moved.width]).toEqual([other.id, 1.1])
    expect(bridge.getNode(wall.id as AnyNodeId)).toBeNull()
  })

  test('an op on a node removed by an earlier cascade is refused', async () => {
    const { wall, window } = await wallWithWindow()
    const result = await apply([
      { op: 'delete', id: wall.id, cascade: true },
      { op: 'update', id: window.id, data: { width: 1 } },
    ])
    expect(result.isError).toBe(true)
    expect(result.text).toContain(`update id "${window.id}" not found`)
    expect(bridge.getNode(wall.id as AnyNodeId)).not.toBeNull()
  })

  test('updates cannot change object or children; echoing current values passes', async () => {
    const { wall, window } = await wallWithWindow()
    const objectChange = await apply([{ op: 'update', id: wall.id, data: { object: 'group' } }])
    expect(objectChange.isError).toBe(true)
    expect(objectChange.text).toContain('immutable_field')

    const echo = await apply([
      {
        op: 'update',
        id: wall.id,
        data: { id: wall.id, type: 'wall', object: 'node', children: [window.id], thickness: 0.25 },
      },
    ])
    expect(echo.isError).toBe(false)
    const stored = bridge.getNode(wall.id as AnyNodeId)
    expect(stored?.type === 'wall' && stored.thickness).toBe(0.25)
  })

  test('an update that adds schema issues is refused; one on an already invalid node is not', async () => {
    const { wall } = await wallWithWindow()
    const invalid = await apply([{ op: 'update', id: wall.id, data: { thickness: 'thick' } }])
    expect(invalid.isError).toBe(true)
    expect(invalid.text).toContain('invalid_update')
    const stored = bridge.getNode(wall.id as AnyNodeId)
    expect(stored?.type === 'wall' && stored.thickness).not.toBe('thick')

    // A legacy node that already fails its schema can still be edited elsewhere.
    const nodes = { ...bridge.getNodes() } as Record<string, unknown>
    nodes[wall.id] = { ...(nodes[wall.id] as object), height: 'legacy' }
    bridge.loadJSON({ nodes, rootNodeIds: bridge.getRootNodeIds() } as never)
    const unrelated = await apply([{ op: 'update', id: wall.id, data: { thickness: 0.3 } }])
    expect(unrelated.isError).toBe(false)
  })

  test("a scripted window's or column's size comes from its script, not a patch", async () => {
    const sha = 'a'.repeat(64)
    const source = {
      kind: 'script',
      language: 'three',
      script: sha,
      artifact: sha,
      params: {},
      manifest: { bounds: { min: [-0.5, 0, -0.1], max: [0.5, 1.2, 0.1] }, triangles: 12 },
    }
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0] })
    const window = WindowNode.parse({ wallId: wall.id, position: [2, 1.2, 0], source })
    const column = ColumnNode.parse({ position: [1, 0, 2], source })
    const seeded = await apply([
      { op: 'create', node: wall, parentId: level.id },
      { op: 'create', node: window, parentId: wall.id },
      { op: 'create', node: column, parentId: level.id },
    ])
    expect(seeded.isError).toBe(false)

    expect((await refusal([{ op: 'update', id: window.id, data: { width: 2 } }])).code).toBe(
      'scripted_field',
    )
    const tall = await refusal([{ op: 'update', id: column.id, data: { height: 4 } }])
    expect([tall.code, tall.message.includes('add_column with nodeId')]).toEqual([
      'scripted_field',
      true,
    ])
    const renamed = await apply([
      { op: 'update', id: column.id, data: { name: 'Doric', height: column.height } },
    ])
    expect(renamed.isError).toBe(false)
  })

  test('refusals reach the client as structured data', async () => {
    const { wall, window } = await wallWithWindow()
    expect(
      await refusal([
        { op: 'create', node: WallNode.parse({ id: wall.id, start: [0, 0], end: [1, 0] }) },
      ]),
    ).toMatchObject({ code: 'node_exists', patchIndex: 0, id: wall.id })
    expect(
      await refusal([{ op: 'update', id: wall.id, data: { id: 'wall_other' } }]),
    ).toMatchObject({
      code: 'identity_change',
      patchIndex: 0,
      id: wall.id,
    })
    expect(await refusal([{ op: 'update', id: wall.id, data: { type: 'fence' } }])).toMatchObject({
      code: 'identity_change',
    })
    const children = await refusal([
      { op: 'update', id: window.id, data: { width: 1.1 } },
      { op: 'update', id: wall.id, data: { children: [] } },
    ])
    expect(children).toMatchObject({ code: 'immutable_field', patchIndex: 1, id: wall.id })
    expect(children.message).toContain('children')
  })

  test('an invalid value in a core union field is refused, not skipped as a plugin kind', async () => {
    const { wall } = await wallWithWindow()
    const door = DoorNode.parse({ wallId: wall.id, position: [4, 1, 0] })
    await apply([{ op: 'create', node: door, parentId: wall.id }])
    const result = await refusal([{ op: 'update', id: door.id, data: { leafCount: 5 } }])
    expect(result).toMatchObject({ code: 'invalid_update', id: door.id })
    const stored = bridge.getNode(door.id as AnyNodeId)
    expect(stored?.type === 'door' && stored.leafCount).toBe(1)
    expect(bridge.validateScene().valid).toBe(true)
  })

  test('a reparent must name an existing parent that can hold children', async () => {
    const { wall, window } = await wallWithWindow()
    const missing = await refusal([
      { op: 'update', id: window.id, data: { parentId: 'wall_missing', wallId: 'wall_missing' } },
    ])
    expect(missing).toMatchObject({ code: 'invalid_parent', patchIndex: 0, id: window.id })

    const zone = ZoneNode.parse({
      name: 'Room',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    })
    await apply([{ op: 'create', node: zone, parentId: level.id }])
    const childless = await refusal([{ op: 'update', id: window.id, data: { parentId: zone.id } }])
    expect(childless).toMatchObject({ code: 'invalid_parent', id: window.id })

    const detached = await refusal([{ op: 'update', id: window.id, data: { parentId: null } }])
    expect(detached).toMatchObject({ code: 'invalid_parent', id: window.id })

    const kept = bridge.getNode(window.id as AnyNodeId)
    expect(kept?.parentId).toBe(wall.id)
    const host = bridge.getNode(wall.id as AnyNodeId)
    expect(host?.type === 'wall' && host.children).toEqual([window.id])
  })

  test('default gutters a delete regenerates cannot be addressed later in the same patch', async () => {
    const roof = RoofNode.parse({})
    const segment = (x: number) =>
      RoofSegmentNode.parse({
        position: [x, 0, 0],
        width: 4,
        depth: 4,
        roofType: 'hip',
        metadata: { autoGutter: true },
      })
    const [a, b] = [segment(0), segment(4)]
    bridge.applyPatch([
      { op: 'create', node: roof, parentId: level.id as AnyNodeId },
      { op: 'create', node: a, parentId: roof.id as AnyNodeId },
      { op: 'create', node: b, parentId: roof.id as AnyNodeId },
    ])
    const gutter = Object.values(bridge.getNodes()).find(
      (n) => n.type === 'gutter' && n.parentId === a.id,
    )!
    const result = await refusal([
      { op: 'delete', id: b.id },
      { op: 'update', id: gutter.id, data: { name: 'Front gutter' } },
    ])
    expect(result).toMatchObject({ code: 'regenerated_default', patchIndex: 1, id: gutter.id })
    expect(bridge.getNode(b.id as AnyNodeId)).not.toBeNull()

    // Naming the regenerated gutter as parent on the node itself is refused too.
    const nested = await refusal([
      { op: 'delete', id: b.id },
      { op: 'create', node: DoorNode.parse({ parentId: gutter.id }) },
    ])
    expect(nested).toMatchObject({ code: 'regenerated_default', patchIndex: 1, id: gutter.id })

    // In its own patch the delete goes through.
    expect((await apply([{ op: 'delete', id: b.id }])).isError).toBe(false)
  })

  test('a host whose default children a delete regenerates cannot be updated in the same patch', async () => {
    const roof = RoofNode.parse({})
    const segment = (x: number) =>
      RoofSegmentNode.parse({
        position: [x, 0, 0],
        width: 4,
        depth: 4,
        roofType: 'hip',
        metadata: { autoGutter: true },
      })
    const [a, b] = [segment(0), segment(4)]
    bridge.applyPatch([
      { op: 'create', node: roof, parentId: level.id as AnyNodeId },
      { op: 'create', node: a, parentId: roof.id as AnyNodeId },
      { op: 'create', node: b, parentId: roof.id as AnyNodeId },
    ])
    const staleChildren = (bridge.getNode(a.id as AnyNodeId) as { children: string[] }).children

    // Restating the pre-delete children would restore obsolete gutter ids.
    const restated = await refusal([
      { op: 'delete', id: b.id },
      { op: 'update', id: a.id, data: { children: staleChildren, name: 'Front slope' } },
    ])
    expect(restated).toMatchObject({ code: 'regenerated_default', patchIndex: 1, id: a.id })
    const renamed = await refusal([
      { op: 'delete', id: b.id },
      { op: 'update', id: a.id, data: { name: 'Front slope' } },
    ])
    expect(renamed).toMatchObject({ code: 'regenerated_default', patchIndex: 1, id: a.id })
    expect(bridge.getNode(b.id as AnyNodeId)).not.toBeNull()
  })

  test('without a bridge deletion planner, a create of an id present at the start is refused', async () => {
    // A bridge that cannot preview its own deletes (the hosted one today) may
    // not merge walls like core does, so the guard cannot assume wall_b is gone.
    const hostedLike = Object.create(bridge) as SceneBridge
    ;(hostedLike as { planDeletion?: unknown }).planDeletion = undefined
    const server = new McpServer({ name: 'hosted-like', version: '0.0.0' })
    registerApplyPatch(server, createSceneOperations({ bridge: hostedLike }))
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    const hostedClient = new Client({ name: 'hosted-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), hostedClient.connect(cliT)])

    const a = WallNode.parse({ id: 'wall_a', start: [0, 0], end: [2, 0] })
    const b = WallNode.parse({ id: 'wall_b', start: [2, 0], end: [4, 0] })
    const spur = WallNode.parse({ id: 'wall_spur', start: [2, 0], end: [2, 2] })
    await apply([a, b, spur].map((node) => ({ op: 'create', node, parentId: level.id })))

    const result = await hostedClient.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'delete', id: spur.id },
          {
            op: 'create',
            node: WallNode.parse({ id: b.id, start: [2, 0], end: [5, 0] }),
            parentId: level.id,
          },
        ],
      },
    })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    expect(JSON.parse(text)).toMatchObject({ code: 'node_exists', patchIndex: 1, id: b.id })
  })

  test('an update of an auto-gutter roof segment unsettles its default gutters', async () => {
    const roof = RoofNode.parse({})
    const segment = RoofSegmentNode.parse({
      width: 4,
      depth: 4,
      roofType: 'hip',
      metadata: { autoGutter: true },
    })
    bridge.applyPatch([
      { op: 'create', node: roof, parentId: level.id as AnyNodeId },
      { op: 'create', node: segment, parentId: roof.id as AnyNodeId },
    ])
    const gutter = Object.values(bridge.getNodes()).find(
      (n) => n.type === 'gutter' && n.parentId === segment.id,
    )!
    const result = await refusal([
      { op: 'update', id: segment.id, data: { roofType: 'gable' } },
      { op: 'update', id: gutter.id, data: { name: 'Front gutter' } },
    ])
    expect(result).toMatchObject({ code: 'regenerated_default', patchIndex: 1, id: gutter.id })
  })

  test('an unregistered plugin kind is updated without schema validation', async () => {
    const pluginNode = {
      object: 'node',
      id: 'bench_plugin-1',
      type: 'fixture:bench',
      parentId: level.id,
      visible: true,
      metadata: {},
      position: [0, 0, 0],
    }
    const nodes = { ...bridge.getNodes(), [pluginNode.id]: pluginNode } as Record<string, unknown>
    bridge.loadJSON({ nodes, rootNodeIds: bridge.getRootNodeIds() } as never)

    const result = await apply([{ op: 'update', id: pluginNode.id, data: { position: [1, 0, 0] } }])
    expect(result.isError).toBe(false)
    expect(
      (bridge.getNode(pluginNode.id as AnyNodeId) as { position?: unknown })?.position,
    ).toEqual([1, 0, 0])
  })
})
