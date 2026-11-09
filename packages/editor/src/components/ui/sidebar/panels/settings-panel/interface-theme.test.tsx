import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { InterfaceThemeRow, SettingsPanel } from '.'

const pressedLabels = (html: string) =>
  [...html.matchAll(/aria-pressed="true"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((match) => match[1])

describe('Interface theme setting', () => {
  test("the row shows the host's value pressed", () => {
    const html = renderToStaticMarkup(<InterfaceThemeRow onChange={() => {}} value="light" />)
    expect(html).toContain('Interface theme')
    expect(pressedLabels(html)).toEqual(['Light'])
  })

  test('Settings shows the row a host passes, and none without it', () => {
    const row = <InterfaceThemeRow onChange={() => {}} value="system" />
    expect(renderToStaticMarkup(<SettingsPanel preferences={row} />)).toContain('Interface theme')
    expect(renderToStaticMarkup(<SettingsPanel />)).not.toContain('Interface theme')
  })
})
