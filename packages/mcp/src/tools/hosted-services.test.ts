import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HostedServiceExecutor } from '@pascal-app/core/agent-operations'
import { AgentRefusal } from '@pascal-app/core/agent-tools'
import { registerHostedServiceTools } from '@pascal-app/mcp/tools/hosted-services'

async function withClient(execute: HostedServiceExecutor, run: (client: Client) => Promise<void>) {
  const server = new McpServer({ name: 'hosted-services-test', version: '1.0.0' })
  registerHostedServiceTools(server, execute)
  const client = new Client({ name: 'service-consumer', version: '1.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}

describe('hosted service MCP contracts', () => {
  test('advertises only the released service actions and truthful side effects', async () => {
    await withClient(
      async () => {
        throw new Error('discovery must not execute a service')
      },
      async (client) => {
        const { tools } = await client.listTools()
        expect(tools.map(({ name }) => name).sort()).toEqual([
          'generate_studio_media',
          'get_site_pull',
          'get_studio_generation',
          'list_pascal_services',
          'pull_site_data',
        ])
        expect(
          tools.find(({ name }) => name === 'list_pascal_services')!.annotations,
        ).toMatchObject({ readOnlyHint: true })
        expect(tools.find(({ name }) => name === 'pull_site_data')!.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        })
        expect(
          tools.find(({ name }) => name === 'generate_studio_media')!.annotations,
        ).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false })
        expect(
          tools.find(({ name }) => name === 'get_studio_generation')!.annotations,
        ).toMatchObject({ readOnlyHint: false, destructiveHint: false })
      },
    )
  })

  test('forwards the service result and bounded request through the real protocol', async () => {
    await withClient(
      async (request) => {
        expect(request).toMatchObject({
          action: 'studio.generate',
          pluginId: 'pascal:architect',
          projectId: 'project_media_test',
          maxCredits: 20,
          input: { modelId: 'available-model', prompt: 'Show the street-facing elevation' },
        })
        expect(request.signal).toBeInstanceOf(AbortSignal)
        return { id: 'render_retained', status: 'pending' }
      },
      async (client) => {
        const result = await client.callTool({
          name: 'generate_studio_media',
          arguments: {
            pluginId: 'pascal:architect',
            projectId: 'project_media_test',
            maxCredits: 20,
            modelId: 'available-model',
            prompt: 'Show the street-facing elevation',
          },
        })
        expect(result.isError).not.toBe(true)
        expect(result.content).toEqual([
          { type: 'text', text: JSON.stringify({ id: 'render_retained', status: 'pending' }) },
        ])
      },
    )
  })

  test('returns an actionable admission refusal without exposing unexpected host failures', async () => {
    for (const [error, expected] of [
      [
        new AgentRefusal(
          'service_consent_required',
          'Reconnect and approve Pascal service access.',
        ),
        'service_consent_required',
      ],
      [new Error('private-provider-configuration'), 'service_error'],
    ] as const) {
      await withClient(
        async () => {
          throw error
        },
        async (client) => {
          const result = await client.callTool({
            name: 'list_pascal_services',
            arguments: { pluginId: 'pascal:architect' },
          })
          expect(result.isError).toBe(true)
          expect(JSON.stringify(result.content)).toContain(expected)
          expect(JSON.stringify(result.content)).not.toContain('private-provider-configuration')
        },
      )
    }
  })
})
