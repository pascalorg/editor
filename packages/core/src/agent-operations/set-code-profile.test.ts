import { describe, expect, test } from 'bun:test'
import { AgentRefusal } from '../agent-tools/refusal'
import { codeProfileOf } from '../building/code-profile'
import { SiteNode } from '../schema'
import { setCodeProfile } from './set-code-profile'

const ctx = { activeLevelId: null }
const sites = (metadata?: Record<string, unknown>) =>
  ({
    site_1: SiteNode.parse({ id: 'site_1', children: [], ...(metadata ? { metadata } : {}) }),
  }) as never

describe('set_code_profile', () => {
  test('a profile that is not one is refused when it bypasses the contract', () => {
    try {
      setCodeProfile(sites(), { profile: 'ncc' } as never, ctx)
      throw new Error('not refused')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRefusal)
      expect((error as AgentRefusal).code).toBe('invalid_input')
    }
  })

  test('set, read back by the checks, and cleared', () => {
    const nodes = sites({ keep: 1 })
    const set = setCodeProfile(nodes, { profile: 'irc-2021' }, ctx)
    const written = { site_1: { ...nodes.site_1, ...set.changes!.update![0]!.data } } as never
    expect(codeProfileOf(written)?.id).toBe('irc-2021')
    expect((written as Record<string, { metadata: unknown }>).site_1!.metadata).toEqual({
      keep: 1,
      codeProfile: 'irc-2021',
    })
    const cleared = setCodeProfile(written, { profile: null }, ctx)
    const after = {
      site_1: {
        ...(written as Record<string, object>).site_1,
        ...cleared.changes!.update![0]!.data,
      },
    } as never
    expect(codeProfileOf(after)).toBeNull()
    expect((after as Record<string, { metadata: unknown }>).site_1!.metadata).toEqual({ keep: 1 })
  })
})
