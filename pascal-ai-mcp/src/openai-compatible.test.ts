import { afterEach, describe, expect, test } from 'bun:test'
import { OpenAiCompatibleClient } from './openai-compatible'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Azure OpenAI requests', () => {
  test('uses the deployment route and api-key authentication', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
    }) as typeof fetch

    const client = new OpenAiCompatibleClient({
      provider: 'azure-openai',
      apiKey: 'secret',
      baseUrl: 'https://example.cognitiveservices.azure.com',
      model: 'gpt-5.4-mini',
      title: 'Pascal AI MCP',
      temperature: 0.2,
      azureDeployment: 'gpt-5.4-mini',
      azureApiVersion: '2024-10-21',
    })

    expect(await client.complete([{ role: 'user', content: 'hello' }], 'session-1')).toBe('ok')
    expect(capturedUrl).toBe(
      'https://example.cognitiveservices.azure.com/openai/deployments/gpt-5.4-mini/chat/completions?api-version=2024-10-21',
    )
    expect(new Headers(capturedInit?.headers).get('api-key')).toBe('secret')
    expect(new Headers(capturedInit?.headers).get('authorization')).toBeNull()
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>
    expect(body.model).toBeUndefined()
    expect(body.session_id).toBeUndefined()
  })

  test('retries Azure rate limits using the server delay', async () => {
    let attempts = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      attempts++
      if (attempts === 1) {
        return new Response('rate limited', {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'retry-after-ms': '1' },
        })
      }
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
    }) as typeof fetch

    const client = new OpenAiCompatibleClient({
      provider: 'azure-openai',
      apiKey: 'secret',
      baseUrl: 'https://example.cognitiveservices.azure.com',
      model: 'gpt-5.4-mini',
      title: 'Pascal AI MCP',
      temperature: 0.2,
      azureDeployment: 'gpt-5.4-mini',
      azureApiVersion: '2024-10-21',
    })

    expect(await client.complete([{ role: 'user', content: 'hello' }], 'session-1')).toBe('ok')
    expect(attempts).toBe(2)
  })
})
