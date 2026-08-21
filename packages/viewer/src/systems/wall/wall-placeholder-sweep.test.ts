import { describe, expect, test } from 'bun:test'
import { isPlaceholderWallGeometry, sweepUnbuiltWalls } from './wall-placeholder-sweep'

// The wall-geometry self-heal: walls stuck on their mount-time placeholder
// (QA f2 probe5/probe6 — a scene loaded with the X-ray already active kept
// all 24 collision meshes as degenerate points forever) get their dirty
// mark re-issued so the normal rebuild loop picks them up.

const placeholderStamped = { userData: { placeholder: true } }
const placeholderLegacy = {
  userData: {},
  getAttribute: (name: string) => (name === 'position' ? { count: 3 } : undefined),
}
const builtWall = {
  userData: {},
  getAttribute: (name: string) => (name === 'position' ? { count: 264 } : undefined),
}

describe('isPlaceholderWallGeometry', () => {
  test('stamped placeholders and 3-vertex degenerate triangles are placeholders', () => {
    expect(isPlaceholderWallGeometry(placeholderStamped)).toBe(true)
    expect(isPlaceholderWallGeometry(placeholderLegacy)).toBe(true)
  })

  test('built wall geometry and missing geometry are not', () => {
    expect(isPlaceholderWallGeometry(builtWall)).toBe(false)
    expect(isPlaceholderWallGeometry(null)).toBe(false)
    expect(isPlaceholderWallGeometry({ userData: {} })).toBe(false)
  })
})

describe('sweepUnbuiltWalls', () => {
  test('re-marks placeholder walls that lost their dirty mark; leaves the rest alone', () => {
    const marked: string[] = []
    const result = sweepUnbuiltWalls({
      wallIds: ['stuck', 'built', 'pending', 'unmounted'],
      geometryOf: (id) =>
        id === 'stuck' || id === 'pending' ? placeholderStamped : id === 'built' ? builtWall : null,
      isDirty: (id) => id === 'pending', // rebuild already queued — don't double-mark
      markDirty: (id) => marked.push(id),
    })
    expect(result).toEqual(['stuck'])
    expect(marked).toEqual(['stuck'])
  })

  test('idempotent once the rebuild lands: a built wall is never re-marked', () => {
    const marked: string[] = []
    sweepUnbuiltWalls({
      wallIds: ['w1'],
      geometryOf: () => builtWall,
      isDirty: () => false,
      markDirty: (id) => marked.push(id),
    })
    expect(marked).toEqual([])
  })

  test('a wall whose mark is consumed without a rebuild converges: sweep → dirty → built', () => {
    // Frame 1: the mark exists (mount). Something consumes it without
    // building. Frame N (sweep): re-marked. Frame N+1: system builds,
    // geometry stops being a placeholder — the sweep goes quiet.
    let dirty = new Set<string>()
    let geometry: typeof placeholderStamped | typeof builtWall = placeholderStamped

    // the mark was lost
    dirty.clear()

    const sweep = () =>
      sweepUnbuiltWalls({
        wallIds: ['w1'],
        geometryOf: () => geometry,
        isDirty: (id) => dirty.has(id),
        markDirty: (id) => dirty.add(id),
      })

    expect(sweep()).toEqual(['w1'])
    expect(dirty.has('w1')).toBe(true)

    // the rebuild loop consumes the mark and fills the geometry
    dirty = new Set()
    geometry = builtWall
    expect(sweep()).toEqual([])
  })
})
