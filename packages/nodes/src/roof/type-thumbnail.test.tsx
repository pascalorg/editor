import { expect, test } from 'bun:test'
import type { RoofType } from '@pascal-app/core'
import { RoofTypeThumbnail } from '@pascal-app/nodes'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('roof thumbnails render portable WebP images without host assets', () => {
  const types: RoofType[] = [
    'hip',
    'gable',
    'shed',
    'flat',
    'gambrel',
    'dutch',
    'mansard',
    'conical',
    'barrel',
  ]
  for (const type of types) {
    const html = renderToStaticMarkup(createElement(RoofTypeThumbnail, { type }))
    const payload = html.match(/src="data:image\/webp;base64,([^"]+)"/)?.[1]
    expect(payload).toBeDefined()
    const bytes = Buffer.from(payload!, 'base64')
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
  }
})
