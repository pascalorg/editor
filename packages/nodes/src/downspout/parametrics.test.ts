import { describe, expect, test } from 'bun:test'
import {
  DownspoutNode,
  defaultDownspoutMetadata,
  usesAutomaticDownspoutLength,
} from '@pascal-app/core'
import { downspoutDefinition } from './index'

const downspoutParametrics = downspoutDefinition.parametrics!

describe('downspout length mode', () => {
  test('switches an automatic downspout to manual when its length is edited', () => {
    const node = DownspoutNode.parse({ length: 6, lengthMode: 'to-ground' })
    expect(downspoutParametrics.derive?.({ ...node, length: 4 }, { length: 4 }, node)).toEqual({
      lengthMode: 'manual',
    })
  })
})

test('explicit automatic mode survives a simultaneous length patch', () => {
  const node = DownspoutNode.parse({ length: 4, lengthMode: 'manual' })
  const patch = { length: 6, lengthMode: 'to-ground' as const }
  const next = { ...node, ...patch }
  const derived = downspoutParametrics.derive?.(next, patch, node)
  expect(usesAutomaticDownspoutLength({ ...next, ...derived })).toBe(true)
})

test('legacy generated downspouts remain automatic and ordinary legacy drops remain manual', () => {
  expect(
    usesAutomaticDownspoutLength(DownspoutNode.parse({ metadata: defaultDownspoutMetadata() })),
  ).toBe(true)
  expect(usesAutomaticDownspoutLength(DownspoutNode.parse({}))).toBe(false)
  const mode = downspoutParametrics
    .groups!.flatMap((group) => group.fields)
    .find((field) => field.key === 'lengthMode')
  expect(mode?.kind).toBe('custom')
})
