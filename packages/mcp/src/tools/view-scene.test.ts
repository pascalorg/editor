import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { refuse } from '@pascal-app/core/agent-tools'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createTestSceneOperations } from './scene-lifecycle/test-utils'
import { registerViewScene, type SceneViewHost } from './view-scene'

// An agent with no view over the MCP (no editor, export_glb unavailable headless)
// and drew its own elevation from coordinates, without materials. Over the MCP the picture comes
// from an editor tab open on the project, which the host asks.

type Content = { type: string; text?: string; data?: string; mimeType?: string }

async function viewWith(
  host: SceneViewHost | undefined,
  { project = true, at }: { project?: boolean; at?: [number, number, number] } = {},
) {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
  const building = Object.values(bridge.getNodes()).find((node) => node.type === 'building')!
  if (at) bridge.updateNode(building.id, { position: at })
  for (const [start, end] of [
    [
      [0, 0],
      [12, 0],
    ],
    [
      [12, 0],
      [12, 8],
    ],
  ] as [number, number][][])
    bridge.createNode(WallNode.parse({ start, end }), level.id)
  const { operations } = createTestSceneOperations({ bridge })
  if (project)
    operations.setActiveScene({
      id: 'scene_a',
      name: 'Hawkesbury',
      projectId: 'project_a',
      ownerId: null,
      thumbnailUrl: null,
      version: 3,
    })
  const server = new McpServer({ name: 'view', version: '1' })
  registerViewScene(server, operations, host)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'view', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  return {
    levelId: level.id,
    call: async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'view_scene', arguments: args })
      return { isError: !!result.isError, content: result.content as Content[] }
    },
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

const json = (content: Content[]) =>
  JSON.parse(content.find((part) => part.type === 'text')!.text!) as Record<string, unknown>

describe('view_scene over the MCP', () => {
  test('an editor tab renders the view the tool sets, and the picture comes back as an image', async () => {
    const asked: unknown[] = []
    const view = await viewWith({
      capture: async (request) => {
        asked.push(request)
        return {
          image: new Uint8Array([1, 2, 3]),
          mimeType: 'image/webp',
          width: request.size.w,
          height: request.size.h,
          tab: 'tab_1',
          capturedAt: '2026-10-05T15:30:00.000Z',
        }
      },
    })
    try {
      const { isError, content } = await view.call({ from: 'south', eyeHeight: 1.7 })
      expect(isError).toBe(false)
      expect(asked).toMatchObject([
        { projectId: 'project_a', pose: { projection: 'perspective' }, size: { w: 1920, h: 1200 } },
      ])
      expect((asked[0] as { pose: { position: number[] } }).pose.position[1]).toBe(1.7)
      expect(content.find((part) => part.type === 'image')).toEqual({
        type: 'image',
        data: Buffer.from([1, 2, 3]).toString('base64'),
        mimeType: 'image/webp',
      })
      expect(json(content)).toMatchObject({
        status: 'viewed',
        size: { width: 1920, height: 1200 },
        tab: 'tab_1',
        capturedAt: '2026-10-05T15:30:00.000Z',
      })
      expect(String(json(content).note)).toContain('not a measure')
    } finally {
      await view.close()
    }
  })

  test('a look inside a floor reaches the editor tab as the floor to cut', async () => {
    const asked: Parameters<SceneViewHost['capture']>[0][] = []
    const view = await viewWith({
      capture: async (request) => {
        asked.push(request)
        return {
          image: new Uint8Array([1]),
          mimeType: 'image/webp',
          width: request.size.w,
          height: request.size.h,
          tab: 'tab_1',
          capturedAt: '2026-10-12T09:00:00.000Z',
        }
      },
    })
    try {
      expect((await view.call({ interior: { levelId: view.levelId } })).isError).toBe(false)
      expect(asked).toMatchObject([{ interior: { levelId: view.levelId } }])
      expect(asked[0]!.pose.position[1]).toBeGreaterThan(asked[0]!.pose.target[1])
      expect((await view.call({ from: 'south' })).isError).toBe(false)
      expect(asked[1]).not.toHaveProperty('interior')
      const wrong = await view.call({ interior: { levelId: 'level_missing' } })
      expect(wrong.isError).toBe(true)
      expect(json(wrong.content)).toMatchObject({ code: 'interior_level_invalid' })
      expect(asked).toHaveLength(2)
    } finally {
      await view.close()
    }
  })

  // A building standing away from the site's origin was looked for at the origin.
  test('a building away from the origin is looked at where it stands', async () => {
    const asked: Parameters<SceneViewHost['capture']>[0][] = []
    const view = await viewWith(
      {
        capture: async (request) => {
          asked.push(request)
          return {
            image: new Uint8Array([1]),
            mimeType: 'image/webp',
            width: request.size.w,
            height: request.size.h,
            tab: 'tab_1',
            capturedAt: '2026-10-12T09:00:00.000Z',
          }
        },
      },
      { at: [5.7, 0, 16.5] },
    )
    try {
      expect((await view.call({ target: view.levelId })).isError).toBe(false)
      // Walls from (0, 0) to (12, 0) and (12, 8): centre (6, 4) in the building's frame.
      const [x, , z] = asked[0]!.pose.target
      expect([Math.round(x * 100) / 100, Math.round(z * 100) / 100]).toEqual([11.7, 20.5])
    } finally {
      await view.close()
    }
  })

  test("the photo's camera renders at the photo's aspect", async () => {
    const sizes: unknown[] = []
    const view = await viewWith({
      capture: async (request) => {
        sizes.push(request.size)
        return {
          image: new Uint8Array([0]),
          mimeType: 'image/webp',
          width: request.size.w,
          height: request.size.h,
          tab: 'tab_1',
          capturedAt: '2026-10-05T15:30:00.000Z',
        }
      },
    })
    try {
      const camera = { position: [6, 1.6, 20], target: [6, 2, 4], fov: 50, aspect: 1.5, shift: 0 }
      expect((await view.call({ camera })).isError).toBe(false)
      expect(sizes).toEqual([{ w: 1920, h: 1280 }])
    } finally {
      await view.close()
    }
  })

  // An agent cropped the photo 9 times in the shell and compared whole facades only. The photo's
  // crop of the element comes back beside the close-up, each image after its label.
  test("the photo's crop comes back beside the view, each image labelled", async () => {
    const crops: unknown[] = []
    const view = await viewWith({
      capture: async (request) => ({
        image: new Uint8Array([1]),
        mimeType: 'image/webp',
        width: request.size.w,
        height: request.size.h,
        tab: 'tab_1',
        capturedAt: '2026-10-05T19:55:00.000Z',
      }),
      crop: async (request) => {
        crops.push(request)
        return { image: new Uint8Array([9]), mimeType: 'image/png', width: 560, height: 270 }
      },
    })
    try {
      const photo = { source: 'data:image/png;base64,AAAA', region: [60, 200, 620, 470] }
      const { isError, content } = await view.call({ photo })
      expect(isError).toBe(false)
      expect(crops).toEqual([photo])
      expect(content.filter((part) => part.type === 'image').map((part) => part.data)).toEqual([
        Buffer.from([1]).toString('base64'),
        Buffer.from([9]).toString('base64'),
      ])
      const texts = content.filter((part) => part.type === 'text').map((part) => part.text ?? '')
      expect(texts.some((text) => text.includes('photo'))).toBe(true)
      expect(json(content)).toMatchObject({ photoRegion: [60, 200, 620, 470] })
    } finally {
      await view.close()
    }
  })

  test('a host that cannot crop a photo says so', async () => {
    const view = await viewWith({
      capture: async () => refuse('unexpected', 'not called'),
    })
    try {
      const { content } = await view.call({ photo: { source: 'x', region: [0, 0, 10, 10] } })
      expect(json(content)).toMatchObject({ code: 'photo_crop_unavailable' })
    } finally {
      await view.close()
    }
  })

  test('with no editor open on the project, it says so', async () => {
    const view = await viewWith({
      capture: async () =>
        refuse('editor_tab_required', 'No editor tab answered: open the project in the editor.'),
    })
    try {
      const { isError, content } = await view.call({})
      expect(isError).toBe(true)
      expect(json(content)).toMatchObject({ code: 'editor_tab_required' })
    } finally {
      await view.close()
    }
  })

  test('a server with no editor to ask, or a session with no project, is refused', async () => {
    const bare = await viewWith(undefined)
    try {
      expect(json((await bare.call({})).content)).toMatchObject({ code: 'view_unavailable' })
    } finally {
      await bare.close()
    }
    const unbound = await viewWith(
      { capture: async () => refuse('unexpected', 'not called') },
      { project: false },
    )
    try {
      expect(json((await unbound.call({})).content)).toMatchObject({ code: 'no_project' })
    } finally {
      await unbound.close()
    }
  })
})
