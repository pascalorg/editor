import { describe, expect, test } from 'bun:test'
import {
  executeHostedServiceTool,
  type HostedServiceRequest,
} from '@pascal-app/core/agent-operations'

const scope = { pluginId: 'pascal:architect', projectId: 'project_site_test' }

describe('hosted service operations', () => {
  test('preserves the pull identity and caller credit ceiling across retries', async () => {
    const calls: HostedServiceRequest[] = []
    const execute = async (request: HostedServiceRequest) => {
      calls.push(request)
      return { operationId: 'operation_retained', status: 'running' }
    }
    const input = {
      ...scope,
      pullKey: 'parcel_pull_001',
      latitude: 0,
      longitude: 0,
      maxCredits: 50,
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await executeHostedServiceTool('pull_site_data', input, execute)).toEqual({
        operationId: 'operation_retained',
        status: 'running',
      })
    }
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
    expect(calls[0]).toMatchObject({
      action: 'site.pull',
      ...scope,
      maxCredits: 50,
      input: { pullKey: 'parcel_pull_001', latitude: 0, longitude: 0 },
    })
    expect(calls[0]!.input).not.toHaveProperty('maxCredits')
  })

  test.each([
    { ...scope, pullKey: 'parcel_pull_001', maxCredits: 50, latitude: 20 },
    { ...scope, pullKey: 'parcel_pull_001', maxCredits: -1, address: 'An address' },
    { ...scope, pullKey: 'parcel_pull_001', address: 'An address' },
    {
      ...scope,
      pullKey: 'parcel_pull_001',
      maxCredits: 50,
      address: 'An address',
      layers: ['research'],
    },
    {
      ...scope,
      pullKey: 'parcel_pull_001',
      maxCredits: 50,
      address: 'An address',
      walletId: 'somebody_else',
    },
  ])('refuses invalid location, budget or undeclared input before host admission (%#)', async (input) => {
    let called = false
    await expect(
      executeHostedServiceTool('pull_site_data', input, async () => {
        called = true
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(called).toBe(false)
  })

  test('reopening dispatches only the retained operation reference', async () => {
    let call: HostedServiceRequest | undefined
    await executeHostedServiceTool(
      'get_site_pull',
      { ...scope, operationId: 'operation_retained' },
      async (request) => {
        call = request
        return { status: 'completed' }
      },
    )
    expect(call).toMatchObject({
      action: 'site.result',
      ...scope,
      input: { operationId: 'operation_retained' },
    })
    expect(call!.maxCredits).toBeUndefined()
  })

  test('cancellation before admission never reaches the host', async () => {
    let called = false
    await expect(
      executeHostedServiceTool(
        'list_pascal_services',
        scope,
        async () => {
          called = true
        },
        AbortSignal.abort(),
      ),
    ).rejects.toBeInstanceOf(Error)
    expect(called).toBe(false)
  })
})
