import { describe, expect, test } from 'bun:test'
import { classifyRoomTypeByName, roomNamePattern, WINDOW_PATTERN } from './room-vocab'

describe('classifyRoomTypeByName: trilingual', () => {
  test('Japanese listing vocabulary', () => {
    expect(classifyRoomTypeByName('主寝室')).toBe('bedroom')
    expect(classifyRoomTypeByName('洋室A')).toBe('bedroom')
    expect(classifyRoomTypeByName('和室')).toBe('bedroom')
    expect(classifyRoomTypeByName('リビング')).toBe('living')
    expect(classifyRoomTypeByName('ダイニング')).toBe('dining')
    expect(classifyRoomTypeByName('キッチン')).toBe('kitchen')
    expect(classifyRoomTypeByName('台所')).toBe('kitchen')
    expect(classifyRoomTypeByName('トイレ')).toBe('bathroom')
    expect(classifyRoomTypeByName('洗面脱衣室')).toBe('bathroom')
    expect(classifyRoomTypeByName('玄関')).toBe('entry')
    expect(classifyRoomTypeByName('廊下')).toBe('hallway')
    expect(classifyRoomTypeByName('書斎')).toBe('study')
    expect(classifyRoomTypeByName('押入')).toBe('storage')
    expect(classifyRoomTypeByName('バルコニー')).toBe('balcony')
  })

  test('Japanese combined LDK resolves to living_kitchen before its parts', () => {
    expect(classifyRoomTypeByName('LDK')).toBe('living_kitchen')
    expect(classifyRoomTypeByName('リビングダイニングキッチン')).toBe('living_kitchen')
    expect(classifyRoomTypeByName('オープンキッチン')).toBe('living_kitchen')
  })

  test('Chinese behavior is unchanged (主卧 has no 室; combined zone; circulation first)', () => {
    expect(classifyRoomTypeByName('主卧')).toBe('bedroom')
    expect(classifyRoomTypeByName('客厅/开放式厨房')).toBe('living_kitchen')
    expect(classifyRoomTypeByName('走廊')).toBe('hallway')
    expect(classifyRoomTypeByName('玄关')).toBe('entry')
    expect(classifyRoomTypeByName('次卫')).toBe('bathroom')
  })

  test('English behavior is unchanged', () => {
    expect(classifyRoomTypeByName('Master Bedroom')).toBe('bedroom')
    expect(classifyRoomTypeByName('Living-Kitchen')).toBe('living_kitchen')
    expect(classifyRoomTypeByName('Hallway')).toBe('hallway')
  })

  test('unknown names fall through to other', () => {
    expect(classifyRoomTypeByName('謎の部屋')).toBe('other')
    expect(classifyRoomTypeByName('')).toBe('other')
  })
})

describe('patterns', () => {
  test('window keyword matches 窗 / window / 窓', () => {
    expect(WINDOW_PATTERN.test('卧室要有窗')).toBe(true)
    expect(WINDOW_PATTERN.test('bedroom window required')).toBe(true)
    expect(WINDOW_PATTERN.test('寝室に窓が必要')).toBe(true)
    expect(WINDOW_PATTERN.test('通风良好')).toBe(false)
  })

  test('roomNamePattern exposes per-type matching for brief facts', () => {
    expect(roomNamePattern('kitchen')?.test('キッチンは独立で')).toBe(true)
    expect(roomNamePattern('bathroom')?.test('風呂とトイレは別々')).toBe(true)
    expect(roomNamePattern('other')).toBeNull()
  })
})
