import { describe, expect, it } from 'vitest'
import { resolveLanguageProfile } from '../locale/profile'
import { ja } from '../locales/ja'
import { zh } from '../locales/zh'
import { parseCjkNumberText } from './cjk'

const zhNumbers = resolveLanguageProfile([zh], 'zh').numberWords
const jaNumbers = resolveLanguageProfile([ja], 'ja').numberWords

function value(text: string, locale: 'zh' | 'ja' = 'zh'): number | null {
  return parseCjkNumberText(text, locale === 'zh' ? zhNumbers : jaNumbers)?.value ?? null
}

describe('CJK number algebra', () => {
  it('composes positional and grouped Chinese numerals', () => {
    expect(value('十五')).toBe(15)
    expect(value('一百五十')).toBe(150)
    expect(value('三百五十万')).toBe(3_500_000)
  })

  it('handles Chinese elliptical shorthands', () => {
    expect(value('一百五')).toBe(150)
    expect(value('三万五')).toBe(35_000)
    expect(value('两千五')).toBe(2500)
  })

  it('composes mixed Arabic digits with CJK scales', () => {
    expect(value('3万')).toBe(30_000)
    expect(value('35万')).toBe(350_000)
    expect(value('3万5千')).toBe(35_000)
    expect(value('1億2千万', 'ja')).toBe(120_000_000)
  })

  it('rejects adjacent bare large scales without breaking valid groups', () => {
    expect(parseCjkNumberText('万万', zhNumbers)).toBeNull()
    expect(parseCjkNumberText('亿万', zhNumbers)).toBeNull()
    expect(value('千万')).toBe(10_000_000)
    expect(value('一億二千万', 'ja')).toBe(120_000_000)
  })

  it('detects only consecutive increasing one-character adjacent ranges', () => {
    const range = parseCjkNumberText('三四个', zhNumbers)
    expect(range).toMatchObject({ value: 3, end: 1, adjacentRange: true })
    expect(parseCjkNumberText('三三', zhNumbers)).toBeNull()
    expect(value('十五')).toBe(15)
  })
})
