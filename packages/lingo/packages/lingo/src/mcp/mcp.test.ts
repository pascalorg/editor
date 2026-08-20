import { describe, expect, it } from 'vitest'
import { lingoObject, quantityField } from '../ai'
import { lingoTool } from './index'

describe('lingoTool', () => {
  it('emits a closed input schema and canonicalizes callback input', async () => {
    const handled: { current: { note: string; weight: number } | null } = { current: null }
    const tool = lingoTool({
      name: 'weigh',
      description: 'Weigh a package.',
      input: {
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
        note: 'string',
      },
      handler: (args) => {
        handled.current = args
        return { ok: true, weight: args.weight, note: args.note }
      },
    })

    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.additionalProperties).toBe(false)

    const good = await tool.callback({ weight: '2 lbs', note: 'box' })
    expect(good.isError).toBeUndefined()
    expect(handled.current?.weight).toBeCloseTo(0.907_184_74, 10)
    expect(handled.current?.note).toBe('box')
    expect(JSON.parse(good.content[0]?.text ?? '{}')).toEqual({
      ok: true,
      weight: 0.907_184_74,
      note: 'box',
    })

    const bad = await tool.callback({ weight: '1,234 kg', note: 'box' })
    expect(bad.isError).toBe(true)
    expect(bad.content[0]?.text).toContain('[AMBIGUOUS_NUMBER]')
  })

  it('returns MCP error content when the handler throws', async () => {
    const tool = lingoTool({
      name: 'fail',
      description: 'Always fails.',
      input: {
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
      },
      handler: async () => {
        throw new Error('rate service unavailable')
      },
    })

    const result = await tool.callback({ weight: '2 lbs' })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'rate service unavailable' }])
  })

  it('unwraps MCP params.arguments envelopes before validating callback input', async () => {
    const handled: { current: { weight: number } | null } = { current: null }
    const tool = lingoTool({
      name: 'weigh_envelope',
      description: 'Weigh a package.',
      input: {
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
      },
      handler: (args) => {
        handled.current = args
        return 'ok'
      },
    })

    const result = await tool.callback({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'weigh_envelope', arguments: { weight: '2 lbs' } },
    })

    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
    expect(handled.current?.weight).toBeCloseTo(0.907_184_74, 10)
  })

  it('does not unwrap tool schemas that legitimately contain params.arguments', async () => {
    const handled: { current: { params: { arguments: string } } | null } = { current: null }
    const tool = lingoTool({
      name: 'uses_params',
      description: 'Uses a params argument object.',
      input: {
        params: lingoObject({ arguments: 'string' }),
      },
      handler: (args) => {
        handled.current = args
        return args.params.arguments
      },
    })

    const result = await tool.callback({ params: { arguments: 'literal payload' } })

    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: 'literal payload' }])
    expect(handled.current).toEqual({ params: { arguments: 'literal payload' } })
  })
})
