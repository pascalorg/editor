import { describe, expect, test } from 'bun:test'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { translate, translateReactNode } from './i18n-core'

describe('translate', () => {
  test('uses Turkish by default when explicitly selected', () => {
    expect(translate('Settings', 'tr')).toBe('Ayarlar')
    expect(translate('  Saved scenes  ', 'tr')).toBe('  Kayıtlı sahneler  ')
  })

  test('keeps English source text unchanged', () => {
    expect(translate('Settings', 'en')).toBe('Settings')
  })

  test('translates dynamic editor labels', () => {
    expect(translate('Level 3', 'tr')).toBe('Kat 3')
    expect(translate('Measure: Distance', 'tr')).toBe('Ölç: Mesafe')
    expect(translate('Snapping: Grid', 'tr')).toBe('Yakalama: Izgara')
    expect(translate('4 objects selected', 'tr')).toBe('4 nesne seçildi')
    expect(translate('Wall is available in Expert mode.', 'tr')).toBe(
      'Duvar yalnızca Uzman modunda kullanılabilir.',
    )
    expect(translate('Image will scale 1.25x from the first point.', 'tr')).toBe(
      'Görsel ilk noktaya göre 1.25 kat ölçeklenecek.',
    )
  })
})

describe('translateReactNode', () => {
  test('adds stable keys to translated static siblings while preserving existing keys', () => {
    const tree = createElement(
      'svg',
      null,
      createElement('path', { key: 'north' }),
      createElement('path'),
    )

    const translated = translateReactNode(tree, 'tr')
    expect(isValidElement<{ children: ReactNode }>(translated)).toBe(true)

    const children = (translated as ReactElement<{ children: ReactNode }>).props.children
    expect(Array.isArray(children)).toBe(true)
    expect((children as ReactElement[]).map((child) => child.key)).toEqual(['north', 'localized-1'])
  })

  test('keeps a single child as one element for asChild primitives', () => {
    const tree = createElement('button', null, createElement('span', null, 'Settings'))

    const translated = translateReactNode(tree, 'tr')
    const child = (translated as ReactElement<{ children: ReactNode }>).props.children

    expect(Array.isArray(child)).toBe(false)
    expect(isValidElement<{ children: ReactNode }>(child)).toBe(true)
    expect((child as ReactElement<{ children: ReactNode }>).props.children).toBe('Ayarlar')
  })

  test('translates semantic string props used by composed editor controls', () => {
    const tree = createElement('section', {
      description: 'Choose how the application interface looks.',
      heading: 'Wall Mode',
      label: 'Settings',
    })

    const translated = translateReactNode(tree, 'tr') as ReactElement<{
      description: string
      heading: string
      label: string
    }>

    expect(translated.props).toMatchObject({
      description: 'Uygulama arayüzünün görünümünü seçin.',
      heading: 'Duvar Modu',
      label: 'Ayarlar',
    })
  })

  test('translates mixed dynamic UI fragments without changing their values', () => {
    const tree = createElement('p', null, 'Calibrated:', ' ', 12, ' m read as ', 3, ' m.')

    const translated = translateReactNode(tree, 'tr') as ReactElement<{ children: ReactNode[] }>
    expect(translated.props.children).toEqual(['Kalibre edildi:', ' ', 12, ' m yerine ', 3, ' m.'])
  })
})
