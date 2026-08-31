import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import {
  AUTO_OFFSET_KEY,
  type AutoOffsetTag,
  autoOffsetInvalidationUpdates,
  newAutoOffsetGroupId,
  readAutoOffsetTag,
  translateAutoOffsetBase,
  withAutoOffsetTag,
  withoutAutoOffsetTag,
} from './auto-offset-tag'

const sampleTag = (): AutoOffsetTag => ({
  group: 'aoff_test',
  dy: 0.6,
  minted: ['duct-fitting_a' as AnyNodeId, 'duct-segment_r' as AnyNodeId],
  base: [{ id: 'duct-segment_run' as AnyNodeId, data: { path: [[0, 2, 0]] } }],
})

describe('auto-offset tag round-trip', () => {
  it('writes then reads back an identical tag', () => {
    const tag = sampleTag()
    const meta = withAutoOffsetTag({ existing: 1 }, tag)
    expect(meta.existing).toBe(1)
    expect(readAutoOffsetTag({ metadata: meta })).toEqual(tag)
  })

  it('replaces a prior tag rather than nesting it', () => {
    const first = sampleTag()
    const second: AutoOffsetTag = { ...first, dy: 1.2, group: 'aoff_two' }
    const meta = withAutoOffsetTag(withAutoOffsetTag({}, first), second)
    expect(readAutoOffsetTag({ metadata: meta })).toEqual(second)
  })

  it('removes the tag while preserving other metadata keys', () => {
    const meta = withAutoOffsetTag({ keep: 'me' }, sampleTag())
    const stripped = withoutAutoOffsetTag(meta)
    expect(stripped).toEqual({ keep: 'me' })
    expect(stripped[AUTO_OFFSET_KEY]).toBeUndefined()
    expect(readAutoOffsetTag({ metadata: stripped })).toBeNull()
  })
})

describe('translateAutoOffsetBase', () => {
  it('moves path and position patches with a rigid offset translation', () => {
    const tag: AutoOffsetTag = {
      ...sampleTag(),
      base: [
        {
          id: 'duct-segment_run' as AnyNodeId,
          data: {
            path: [
              [0, 0, 0],
              [2, 0, 0],
            ],
          },
        },
        {
          id: 'duct-fitting_elbow' as AnyNodeId,
          data: { position: [4, 1, 5], angle: 90 },
        },
      ],
    }

    const moved = translateAutoOffsetBase(tag, [1, 0, -2])

    expect(moved.base[0]?.data.path).toEqual([
      [1, 0, -2],
      [3, 0, -2],
    ])
    expect(moved.base[1]?.data.position).toEqual([5, 1, 3])
    expect(moved.base[1]?.data.angle).toBe(90)
  })
})

describe('autoOffsetInvalidationUpdates', () => {
  it('clears owner tags when a generated offset part is edited manually', () => {
    const owner = {
      id: 'duct-segment_owner' as AnyNodeId,
      metadata: withAutoOffsetTag({}, sampleTag()),
    } as AnyNode
    const other = {
      id: 'duct-segment_other' as AnyNodeId,
      metadata: withAutoOffsetTag({}, { ...sampleTag(), minted: ['duct-fitting_other'] }),
    } as AnyNode

    const updates = autoOffsetInvalidationUpdates(
      {
        [owner.id]: owner,
        [other.id]: other,
      },
      'duct-fitting_a' as AnyNodeId,
    )

    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe(owner.id)
    expect(readAutoOffsetTag({ metadata: updates[0]?.data.metadata })).toBeNull()
  })

  it('clears owner tags when a stored base participant is edited manually', () => {
    const owner = {
      id: 'duct-segment_owner' as AnyNodeId,
      metadata: withAutoOffsetTag(
        {},
        {
          ...sampleTag(),
          base: [
            { id: 'duct-segment_owner' as AnyNodeId, data: { path: [[0, 0, 0]] } },
            { id: 'duct-fitting_corner' as AnyNodeId, data: { position: [1, 0, 0] } },
          ],
        },
      ),
    } as AnyNode

    const updates = autoOffsetInvalidationUpdates(
      { [owner.id]: owner },
      'duct-fitting_corner' as AnyNodeId,
    )

    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe(owner.id)
    expect(readAutoOffsetTag({ metadata: updates[0]?.data.metadata })).toBeNull()
  })
})

describe('readAutoOffsetTag guards', () => {
  it('returns null for missing / empty metadata', () => {
    expect(readAutoOffsetTag(null)).toBeNull()
    expect(readAutoOffsetTag(undefined)).toBeNull()
    expect(readAutoOffsetTag({})).toBeNull()
    expect(readAutoOffsetTag({ metadata: {} })).toBeNull()
  })

  it('returns null for a malformed tag (wrong field shapes)', () => {
    const bad = [
      { group: 1, dy: 0, minted: [], base: [] },
      { group: 'g', dy: 'x', minted: [], base: [] },
      { group: 'g', dy: 0, minted: 'nope', base: [] },
      { group: 'g', dy: 0, minted: [], base: {} },
    ]
    for (const tag of bad) {
      expect(readAutoOffsetTag({ metadata: { [AUTO_OFFSET_KEY]: tag } })).toBeNull()
    }
  })
})

describe('newAutoOffsetGroupId', () => {
  it('produces a prefixed, unique-ish id', () => {
    const a = newAutoOffsetGroupId()
    const b = newAutoOffsetGroupId()
    expect(a.startsWith('aoff_')).toBe(true)
    expect(a).not.toBe(b)
  })
})
