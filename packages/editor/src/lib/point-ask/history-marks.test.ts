import { describe, expect, test } from 'bun:test'
import { createdSince, markHistory, stateAfterMark, stepsSince } from './history-marks'

// Undo from a pin steps back through what the ask's turn wrote. The scene history keeps only the
// last 50 steps and a Cmd+Z shrinks it, so a length alone lies: the mark holds the last step that
// stood when the turn began, and the steps since are counted from where that step is now.
const steps = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i }))

describe('stepsSince', () => {
  test('counts the steps pushed after the mark', () => {
    const past = steps(3)
    const mark = markHistory(past)
    const later = [...past, ...steps(2, 3)]

    expect(stepsSince(later, mark)).toBe(2)
    expect(stepsSince(past, mark)).toBe(0)
  })

  test('an empty history at the mark counts everything since', () => {
    const mark = markHistory([])

    expect(stepsSince(steps(4), mark)).toBe(4)
  })

  test('still counts once old steps fall off the front (the history limit)', () => {
    const past = steps(50)
    const mark = markHistory(past)
    const later = [...past, ...steps(3, 50)].slice(3)

    expect(stepsSince(later, mark)).toBe(3)
  })

  test('is null when the marked step itself fell off, so the whole turn cannot be undone', () => {
    const past = steps(50)
    const mark = markHistory(past)
    const later = [...past, ...steps(60, 50)].slice(-50)

    expect(stepsSince(later, mark)).toBeNull()
  })

  test('is null after the person undid back past the mark', () => {
    const past = steps(5)
    const mark = markHistory(past)

    expect(stepsSince(past.slice(0, 2), mark)).toBeNull()
  })

  test('a Cmd+Z that only took part of the turn leaves the rest countable', () => {
    const past = steps(3)
    const mark = markHistory(past)
    const written = [...past, ...steps(4, 3)]
    const afterOneUndo = written.slice(0, -1)

    expect(stepsSince(afterOneUndo, mark)).toBe(3)
  })
})

describe('stateAfterMark', () => {
  test('is the state the first step since the mark was taken from', () => {
    const past = steps(3)
    const mark = markHistory(past)
    const later = [...past, ...steps(2, 3)]

    expect(stateAfterMark(later, mark)).toBe(later[3] ?? null)
  })

  test('with an empty history at the mark it is the oldest state', () => {
    const mark = markHistory([])
    const later = steps(2)

    expect(stateAfterMark(later, mark)).toBe(later[0] ?? null)
  })

  test('is null when nothing was pushed since the mark, or the marked step is gone', () => {
    const past = steps(3)
    const mark = markHistory(past)

    expect(stateAfterMark(past, mark)).toBeNull()
    expect(stateAfterMark(steps(2, 10), mark)).toBeNull()
  })
})

describe('createdSince', () => {
  test('is the nodes the scene has now that the earlier state did not', () => {
    const before = { wall_a: {}, window_a: {} }
    const now = { wall_a: {}, window_a: {}, window_b: {}, wall_b: {} }

    expect(createdSince(before, now).sort()).toEqual(['wall_b', 'window_b'])
  })

  test('a node only changed is not created, and one deleted is not either', () => {
    expect(createdSince({ a: {}, b: {} }, { a: { width: 2 } })).toEqual([])
  })
})
