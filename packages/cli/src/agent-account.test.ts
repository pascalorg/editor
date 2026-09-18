import { describe, expect, test } from 'bun:test'
import { agentClaimHandoffUrl, getAgentStatus, startAgentClaim } from './agent-account.js'
import { CliError } from './errors.js'

const API_KEY = 'sk_live_private-agent-key'
const VALID_CLAIM = {
  claimCode: 'BCDF-GHJK-LMNP',
  claimUrl: 'https://editor.pascal.app/settings/agents/claim',
  expiresAt: '2026-09-10T18:30:00.000Z',
}
const VALID_STATUS = {
  schemaVersion: 1 as const,
  agentId: 'agent_test',
  mode: 'autonomous' as const,
  claimed: false,
  organizationScoped: true,
}

describe('agent account claims', () => {
  test('builds a prefilled handoff URL without changing the API result', () => {
    expect(agentClaimHandoffUrl(VALID_CLAIM)).toBe(
      'https://editor.pascal.app/settings/agents/claim?code=BCDF-GHJK-LMNP',
    )
    expect(VALID_CLAIM.claimUrl).toBe('https://editor.pascal.app/settings/agents/claim')
  })

  test('starts a claim with the agent credential and returns the bounded public result', async () => {
    let authorization: string | null = null
    let redirect: RequestRedirect | undefined
    const fetchMock: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization')
      redirect = init?.redirect
      return Response.json({
        ...VALID_CLAIM,
        agent: { name: '\u001b[2Jmalicious', client: 'openclaw' },
        message: 'server copy is not part of the CLI result',
      })
    }

    const result = await startAgentClaim(API_KEY, { fetch: fetchMock })

    expect(authorization).toBe(`Bearer ${API_KEY}`)
    expect(redirect).toBe('error')
    expect(result).toEqual(VALID_CLAIM)
  })

  test.each([
    [400, 'agent_claim_not_available'],
    [401, 'agent_claim_unauthorized'],
    [403, 'agent_claim_forbidden'],
    [409, 'agent_already_claimed'],
    [429, 'agent_claim_rate_limited'],
    [503, 'agent_claim_failed'],
  ])('maps HTTP %i without exposing the API key or response body', async (status, code) => {
    const fetchMock: typeof fetch = async () =>
      new Response(`<html>credential ${API_KEY} rejected</html>`, {
        headers: { 'content-type': 'text/html' },
        status,
      })

    const error = await captureError(() => startAgentClaim(API_KEY, { fetch: fetchMock }))

    expect(error.code).toBe(code)
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(error.message).not.toContain(API_KEY)
  })

  test('rejects malformed or chunked oversized responses', async () => {
    const malformed: typeof fetch = async () => Response.json({ ...VALID_CLAIM, claimCode: '123' })
    const unsafeDate: typeof fetch = async () =>
      Response.json({ ...VALID_CLAIM, expiresAt: 'Wed, 10 Sep 2026 18:30:00 GMT (\u001b[2J)' })
    const oversized: typeof fetch = async () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('{"padding":"'))
            controller.enqueue(encoder.encode('x'.repeat(33 * 1024)))
            controller.close()
          },
        }),
      )
    }

    expect((await captureError(() => startAgentClaim(API_KEY, { fetch: malformed }))).code).toBe(
      'agent_claim_invalid_response',
    )
    expect((await captureError(() => startAgentClaim(API_KEY, { fetch: unsafeDate }))).code).toBe(
      'agent_claim_invalid_response',
    )
    expect((await captureError(() => startAgentClaim(API_KEY, { fetch: oversized }))).code).toBe(
      'agent_claim_invalid_response',
    )
  })

  test('reports network failures and bounded timeouts without reflecting secrets', async () => {
    const unavailable: typeof fetch = async () => {
      throw new Error(`failed with ${API_KEY}`)
    }
    const pending: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })

    const networkError = await captureError(() => startAgentClaim(API_KEY, { fetch: unavailable }))
    const timeoutError = await captureError(() =>
      startAgentClaim(API_KEY, { fetch: pending, timeoutMs: 1 }),
    )

    expect(networkError.code).toBe('agent_claim_unavailable')
    expect(timeoutError.code).toBe('agent_claim_timeout')
    expect(`${networkError.message}${timeoutError.message}`).not.toContain(API_KEY)
  })

  test('keeps the timeout active while reading the response body', async () => {
    const stalled: typeof fetch = async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), {
              once: true,
            })
          },
        }),
      )

    const error = await captureError(() =>
      startAgentClaim(API_KEY, { fetch: stalled, timeoutMs: 1 }),
    )

    expect(error.code).toBe('agent_claim_timeout')
  })

  test('checks status with the agent credential and returns the bounded public result', async () => {
    let endpoint = ''
    let method = ''
    let authorization: string | null = null
    let redirect: RequestRedirect | undefined
    const fetchMock: typeof fetch = async (input, init) => {
      endpoint = String(input)
      method = init?.method ?? ''
      authorization = new Headers(init?.headers).get('authorization')
      redirect = init?.redirect
      return Response.json({
        ...VALID_STATUS,
        agentName: '\u001b[2Jmalicious',
        credentialName: API_KEY,
      })
    }

    const result = await getAgentStatus(API_KEY, { fetch: fetchMock })

    expect(endpoint).toBe('https://editor.pascal.app/api/auth/agent/status')
    expect(method).toBe('GET')
    expect(authorization).toBe(`Bearer ${API_KEY}`)
    expect(redirect).toBe('error')
    expect(result).toEqual(VALID_STATUS)
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })

  test.each([
    [401, 'agent_status_unauthorized'],
    [403, 'agent_status_forbidden'],
    [503, 'agent_status_failed'],
  ])('maps status HTTP %i without exposing the API key or response body', async (status, code) => {
    const fetchMock: typeof fetch = async () =>
      new Response(`<html>credential ${API_KEY} rejected</html>`, { status })

    const error = await captureError(() => getAgentStatus(API_KEY, { fetch: fetchMock }))

    expect(error.code).toBe(code)
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(error.message).not.toContain(API_KEY)
  })

  test('rejects malformed and oversized status responses', async () => {
    const malformed: typeof fetch = async () => Response.json({ ...VALID_STATUS, claimed: 'false' })
    const oversized: typeof fetch = async () =>
      new Response(JSON.stringify({ ...VALID_STATUS, padding: 'x'.repeat(33 * 1024) }))

    expect((await captureError(() => getAgentStatus(API_KEY, { fetch: malformed }))).code).toBe(
      'agent_status_invalid_response',
    )
    expect((await captureError(() => getAgentStatus(API_KEY, { fetch: oversized }))).code).toBe(
      'agent_status_invalid_response',
    )
  })

  test('reports status network failures and bounded timeouts', async () => {
    const unavailable: typeof fetch = async () => {
      throw new Error(`failed with ${API_KEY}`)
    }
    const pending: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })

    expect((await captureError(() => getAgentStatus(API_KEY, { fetch: unavailable }))).code).toBe(
      'agent_status_unavailable',
    )
    expect(
      (await captureError(() => getAgentStatus(API_KEY, { fetch: pending, timeoutMs: 1 }))).code,
    ).toBe('agent_status_timeout')
  })
})

async function captureError(run: () => Promise<unknown>): Promise<CliError> {
  try {
    await run()
    throw new Error('Expected the operation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(CliError)
    return error as CliError
  }
}
