import { describe, expect, test } from 'bun:test'
import { messages, translate, translateDisplayText } from './i18n'

describe('editor translations', () => {
  test('keeps locale catalogs aligned', () => {
    expect(Object.keys(messages['zh-CN']).sort()).toEqual(Object.keys(messages.en).sort())
  })

  test('translates display text without translating domain values', () => {
    expect(translate('zh-CN', 'build.wall')).toBe('墙体')
    expect(translateDisplayText('zh-CN', 'Nature')).toBe('自然')
    expect(translateDisplayText('zh-CN', 'Floor 3')).toBe('3 层')
    expect(translateDisplayText('zh-CN', 'Basement 2')).toBe('地下 2 层')
    expect(
      translateDisplayText(
        'zh-CN',
        'Drainage reserves 0.80 m gutters; hydrants reserve a 1.20 m roadside verge.',
      ),
    ).toBe('排水设施预留 0.80 m 路缘排水带；消防栓预留 1.20 m 路侧绿化带。')
    expect(translateDisplayText('zh-CN', 'Merge node node-2 into node-1')).toBe(
      '将节点 node-2 合并到 node-1',
    )
    expect(translateDisplayText('zh-CN', 'Daisy')).toBe('雏菊')
    expect(translateDisplayText('zh-CN', 'Fescue')).toBe('羊茅')
    expect(translateDisplayText('zh-CN', 'unknown-node-kind')).toBe('unknown-node-kind')
    expect(translateDisplayText('en', 'Nature')).toBe('Nature')
    expect(JSON.stringify(messages['zh-CN'])).not.toContain('"Repeat"')
  })
})
