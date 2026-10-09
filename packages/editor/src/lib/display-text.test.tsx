import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DisplayTextProvider, useDisplayText } from './display-text'

function Probe() {
  const t = useDisplayText()
  return <span>{t('Nature')}</span>
}

describe('DisplayTextProvider', () => {
  test('keeps text unchanged by default', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('Nature')
  })

  test('translates presentation text at the render boundary', () => {
    const html = renderToStaticMarkup(
      <DisplayTextProvider translate={(text) => (text === 'Nature' ? '自然' : text)}>
        <Probe />
      </DisplayTextProvider>,
    )
    expect(html).toContain('自然')
  })
})
