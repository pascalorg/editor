import { describe, expect, test } from 'bun:test'
import { requiredFurnitureFor } from './furniture-checklist'

// 2026-07-16 线上事故回归：厕纸被当马桶、淋浴地垫被当淋浴（gate 与候选过滤
// 共用 option.match，这里直接测 matcher 本身）。
function matcherOf(key: string, optionLabel?: string): RegExp {
  const requirement = requiredFurnitureFor('bathroom').find(entry => entry.key === key)
  if (!requirement) throw new Error(`missing requirement ${key}`)
  const option = optionLabel
    ? requirement.options.find(entry => entry.label === optionLabel)
    : requirement.options[0]
  if (!option) throw new Error(`missing option ${optionLabel}`)
  return option.match
}

describe('卫浴洁具 matcher：主体命中、配件拒绝', () => {
  const toilet = () => matcherOf('toilet')
  const shower = () => matcherOf('shower_or_bathtub', '淋浴')
  const bathtub = () => matcherOf('shower_or_bathtub', '浴缸')

  test('马桶主体命中', () => {
    for (const name of ['toilet', 'wall-hung-toilet', 'Wall Hung Toilet 02', 'WC', '马桶', '坐便器', '便器', 'トイレ']) {
      expect(toilet().test(name)).toBe(true)
    }
  })

  test('马桶配件拒绝', () => {
    for (const name of [
      'toilet-paper', 'toilet paper', 'Toilet Roll Holder', 'toilet-brush', 'toilet_brush',
      'toilet-seat', 'トイレットペーパー', 'トイレブラシ',
    ]) {
      expect(toilet().test(name)).toBe(false)
    }
  })

  test('淋浴主体命中', () => {
    for (const name of ['shower', 'shower-cabin', 'Shower Cabin 01', 'walk-in-shower', 'shower enclosure', '淋浴房', 'シャワーブース']) {
      expect(shower().test(name)).toBe(true)
    }
  })

  test('淋浴配件拒绝', () => {
    for (const name of [
      'shower-rug', 'shower rug', 'shower-mat', 'shower-curtain', 'Shower Curtain 03',
      'shower-head', 'bath-mat', '淋浴帘', '淋浴垫', 'シャワーカーテン', 'シャワーマット',
    ]) {
      expect(shower().test(name)).toBe(false)
      expect(bathtub().test(name)).toBe(false)
    }
  })

  test('组合卫浴名取子类型并集，不按第一个词缩成单项（tpl-jp-1k-26 复盘）', () => {
    const keysOf = (name: string) =>
      requiredFurnitureFor('bathroom', name, 'jp').map(requirement => requirement.key).sort()
    expect(keysOf('浴室・トイレ')).toEqual(['shower_or_bathtub', 'toilet'])
    expect(keysOf('浴室・洗面')).toEqual(['shower_or_bathtub', 'washbasin'])
    expect(keysOf('洗面・トイレ')).toEqual(['toilet', 'washbasin'])
    // 单一子类型不受影响。
    expect(keysOf('トイレ')).toEqual(['toilet'])
    // 全组合等价于全套。
    expect(keysOf('浴室・洗面・トイレ')).toEqual(['shower_or_bathtub', 'toilet', 'washbasin'])
  })

  test('浴缸主体命中、浴缸垫拒绝', () => {
    for (const name of ['bathtub', 'Bathtub 02', 'freestanding tub', '浴缸', '浴槽', 'バスタブ']) {
      expect(bathtub().test(name)).toBe(true)
    }
    expect(bathtub().test('bathtub-mat')).toBe(false)
  })
})
