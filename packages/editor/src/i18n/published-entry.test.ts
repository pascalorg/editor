import { expect, test } from 'bun:test'
import { createI18n } from '@pascal-app/editor'

test('the published editor entry registers compiled English messages', () => {
  const i18n = createI18n({ locale: 'en' })
  try {
    expect(
      i18n._({
        id: 'viewer.levels.label',
        message: 'Levels: {mode}',
        values: { mode: 'Stacked' },
      }),
    ).toBe('Levels: Stacked')
  } finally {
    i18n.destroy()
  }
})
