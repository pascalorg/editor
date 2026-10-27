import { expect, test } from 'bun:test'
import { createI18n, getLocale, PascalI18nProvider, setLocale } from '@pascal-app/core'
import { renderToString } from 'react-dom/server'
import { parseSliderBareValue, SliderControl } from './slider-control'

test('slider numbers use the scoped locale for display and parsing while the global locale is English', () => {
  setLocale('en')
  const i18n = createI18n({ locale: 'fr' })
  try {
    const html = renderToString(
      <PascalI18nProvider i18n={i18n}>
        <SliderControl label="Length" onChange={() => {}} precision={2} value={2.75} />
      </PascalI18nProvider>,
    )

    expect(getLocale()).toBe('en')
    expect(html).toContain('2,75')
    expect(parseSliderBareValue('2,75', i18n.getLocale())).toBe(2.75)
    expect(parseSliderBareValue('1e2', i18n.getLocale())).toBe(100)
  } finally {
    i18n.destroy()
  }
})
