import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import type { HostedServiceRequest } from '@pascal-app/core/agent-operations'
import { registerHostedServiceTools } from './hosted-services'

type Content = { type: string; text?: string; data?: string; mimeType?: string }

async function serve(answer: (request: HostedServiceRequest) => unknown) {
  const asked: HostedServiceRequest[] = []
  const server = new McpServer({ name: 'services', version: '1' })
  registerHostedServiceTools(server, async (request) => {
    asked.push(request)
    return answer(request)
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'services', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  return {
    asked,
    call: async (name: string, args: Record<string, unknown>) =>
      ((await client.callTool({ name, arguments: args })).content ?? []) as Content[],
    close: () => Promise.all([client.close(), server.close()]),
  }
}

describe('hosted service tools over the MCP', () => {
  test("a render's preview comes back as a picture beside its job, never inside the JSON", async () => {
    const pixels = Buffer.from('webp').toString('base64')
    const services = await serve(() => ({
      id: 'render_1',
      status: 'completed',
      image_url: 'https://example.invalid/render_1.png',
      preview: `data:image/webp;base64,${pixels}`,
    }))
    try {
      const content = await services.call('get_studio_generation', {
        id: 'render_1',
        includePreview: true,
      })
      expect(services.asked[0]).toMatchObject({
        action: 'studio.status',
        input: { id: 'render_1', includePreview: true },
      })
      expect(services.asked[0]!.pluginId).toBeUndefined()
      expect(JSON.parse(content[0]!.text!)).toEqual({
        id: 'render_1',
        status: 'completed',
        image_url: 'https://example.invalid/render_1.png',
      })
      expect(content[1]).toEqual({ type: 'image', data: pixels, mimeType: 'image/webp' })
    } finally {
      await services.close()
    }
  })

  test('a quote is text alone, and a submission names its key', async () => {
    const services = await serve((request) =>
      request.input.quoteToken
        ? { id: 'render_2', status: 'pending' }
        : { status: 'quote', quote: { credits: 8, quoteToken: 'v1.a.b' } },
    )
    try {
      const input = {
        modelId: 'nano-banana-2-1',
        prompt: 'The kitchen at dusk',
        generationKey: 'render_kitchen_01',
        sources: [{ type: 'view', id: `${'a'.repeat(64)}.webp` }],
      }
      const quoted = await services.call('generate_studio_media', input)
      expect(quoted).toHaveLength(1)
      expect(JSON.parse(quoted[0]!.text!)).toMatchObject({ status: 'quote' })
      await services.call('generate_studio_media', { ...input, quoteToken: 'v1.a.b' })
      expect(services.asked[1]).toMatchObject({
        action: 'studio.generate',
        input: { generationKey: 'render_kitchen_01', quoteToken: 'v1.a.b' },
      })
    } finally {
      await services.close()
    }
  })
})
