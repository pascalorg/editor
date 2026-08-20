import { describe, expect, test } from 'bun:test'
import { ARTICRAFT_ICON, ARTICRAFT_MARK_DATA_URL } from './brand'

describe('Articraft brand mark', () => {
  test('embeds the reviewed package asset without a runtime fetch', async () => {
    const asset = await Bun.file(
      new URL('../assets/articraft-mark.webp', import.meta.url),
    ).arrayBuffer()
    const expected = `data:image/webp;base64,${Buffer.from(asset).toString('base64')}`

    expect(String(ARTICRAFT_MARK_DATA_URL)).toBe(expected)
    expect({ kind: ARTICRAFT_ICON.kind, src: String(ARTICRAFT_ICON.src) }).toEqual({
      kind: 'url',
      src: expected,
    })
  })
})
