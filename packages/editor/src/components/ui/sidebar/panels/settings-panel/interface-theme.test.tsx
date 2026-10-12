import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsPanel } from '.'

const pressedLabels = (html: string) =>
  [...html.matchAll(/aria-pressed="true"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((match) => match[1])

describe('Interface theme setting', () => {
  test('a host that owns the theme gets the row, with its value pressed', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel interfaceTheme={{ onChange: () => {}, value: 'light' }} />,
    )
    expect(html).toContain('Interface theme')
    expect(pressedLabels(html)).toEqual(['Light'])
  })

  test('a host without one shows no theme row', () => {
    expect(renderToStaticMarkup(<SettingsPanel />)).not.toContain('Interface theme')
  })
})
