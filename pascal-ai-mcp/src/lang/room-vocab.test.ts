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

// --- i18n (reply language) ---------------------------------------------------
import { detectLanguage, issueText, t } from './i18n'

describe('detectLanguage', () => {
  test('kana → ja; han without kana → zh; else en', () => {
    expect(detectLanguage('3LDKの間取りをお願いします')).toBe('ja')
    expect(detectLanguage('間取り図')).toBe('ja') // り is kana
    expect(detectLanguage('玄関')).toBe('zh') // pure kanji is indistinguishable from Chinese; han wins
    expect(detectLanguage('三室一厅，70平米')).toBe('zh')
    expect(detectLanguage('A 70 sqm two-bedroom flat')).toBe('en')
    expect(detectLanguage('')).toBe('en')
    expect(detectLanguage(undefined)).toBe('en')
  })
})

describe('reply templates', () => {
  test('t renders per language and defaults to en', () => {
    expect(t('zh', 'modifySuccess', {})).toContain('已按你的要求')
    expect(t('ja', 'modifySuccess', {})).toContain('ご要望どおり')
    expect(t('en', 'modifySuccess', {})).toContain('modified as requested')
    expect(t(undefined, 'modifySuccess', {})).toContain('modified as requested')
  })

  test('issue templates render structured findings in each language', () => {
    expect(issueText('ja', 'doorlessRoom', { room: '寝室' })).toContain('ドアがなく')
    expect(issueText('en', 'isolatedBedroom', { room: 'Bedroom A' })).toContain('invalid circulation')
    expect(issueText('zh', 'gateMissingRoom', { type: 'bedroom', actual: 1, expected: 2 }))
      .toBe('房型「bedroom」只有 1 间，brief 要求 2 间')
  })
})
