import { describe, expect, test } from 'bun:test'
import { Definition } from '@pascal-app/core'
import { createDefinitionThumbnail } from './component-actions'

describe('component actions', () => {
  test('creates an asset-safe inline thumbnail for a definition', () => {
    const thumbnail = createDefinitionThumbnail('Balcony Type A')

    expect(thumbnail).toStartWith('data:image/svg+xml,')
    expect(
      Definition.safeParse({
        id: 'definition_thumbnail',
        name: 'Balcony Type A',
        rootNodeId: 'shelf_source',
        thumbnail,
      }).success,
    ).toBe(true)
  })
})
