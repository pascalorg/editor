import { describe, expect, test } from 'bun:test'
import { countGraphNodes, isEmptyGraphOverwrite } from './empty-graph-guard'

describe('countGraphNodes', () => {
  test('counts nodes on a well-formed graph', () => {
    expect(countGraphNodes({ nodes: { a: {}, b: {} } })).toBe(2)
  })

  test('treats missing/odd shapes as empty', () => {
    expect(countGraphNodes(null)).toBe(0)
    expect(countGraphNodes(undefined)).toBe(0)
    expect(countGraphNodes({})).toBe(0)
    expect(countGraphNodes({ nodes: null })).toBe(0)
  })
})

describe('isEmptyGraphOverwrite', () => {
  test('blocks a 0-node write over a populated server copy (the wipe class)', () => {
    // Scene-wipe repro 2026-08-18: a pre-hydration autosave flush serialized
    // the empty editor store and PUT it over a 74-node scene at If-Match: 1,
    // leaving v2 with 0 nodes. This is the exact write that must not pass.
    expect(isEmptyGraphOverwrite(0, 74)).toBe(true)
    expect(isEmptyGraphOverwrite(0, 1)).toBe(true)
  })

  test('allows saves that carry nodes', () => {
    expect(isEmptyGraphOverwrite(74, 74)).toBe(false)
    expect(isEmptyGraphOverwrite(1, 74)).toBe(false)
  })

  test('allows empty saves over an already-empty scene', () => {
    expect(isEmptyGraphOverwrite(0, 0)).toBe(false)
  })
})
