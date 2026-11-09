import { describe, expect, test } from 'bun:test'
import {
  alsoChangedLine,
  cardCarriedFromPointer,
  cardTitle,
  createPin,
  type PinEvent,
  type PinModel,
  reducePin,
} from './pin-machine'

// The pin keeps the ask's promise in place (spec 2.6-2.8). Written first: a pin that turns to a
// check for a step that wrote nothing; commits counted before the turn started;
// a question shown as "no change"; Undo from a state with nothing to undo; a late event undoing a
// finished pin.

const ASK = 'ask_1'

const fresh = () => createPin({ askId: ASK, text: 'Make it wider', targetIds: ['window_1'] })

const status = (more: Record<string, unknown>): PinEvent =>
  ({ type: 'status', status: { askId: ASK, ...more } }) as PinEvent

const play = (pin: PinModel, ...events: PinEvent[]) => events.reduce(reducePin, pin)

const commit = (ids: string[], inTargets: (id: string) => boolean = () => false): PinEvent => ({
  type: 'commit',
  changedNodeIds: ids,
  isInTargets: inTargets,
})

const working = (pin: PinModel = fresh()) => play(pin, status({ status: 'working' }))

describe('a new pin', () => {
  test('starts as sent, with nothing landed', () => {
    const pin = fresh()

    expect(pin).toMatchObject({
      askId: ASK,
      text: 'Make it wider',
      targetIds: ['window_1'],
      state: 'sent',
      landed: 0,
      changedTargetIds: [],
      alsoChangedIds: [],
      ended: false,
      undone: false,
      kept: false,
    })
  })

  test('the sent event changes nothing', () => {
    expect(play(fresh(), { type: 'sent' })).toEqual(fresh())
  })
})

describe('queued and working', () => {
  test('queued while Pascal is on another turn', () => {
    const pin = play(fresh(), status({ status: 'queued', turnId: 't1' }))

    expect(pin.state).toBe('queued')
    expect(pin.turnId).toBe('t1')
  })

  test('working from sent or from queued, with the live sentence', () => {
    const direct = play(fresh(), status({ status: 'working', sentence: 'Widening the window' }))
    const queued = play(fresh(), status({ status: 'queued' }), status({ status: 'working' }))

    expect(direct.state).toBe('working')
    expect(direct.sentence).toBe('Widening the window')
    expect(queued.state).toBe('working')
  })

  test('a new sentence updates it and keeps the state', () => {
    const pin = play(
      working(),
      status({ status: 'working', sentence: 'Looking at the wall' }),
      status({ status: 'working', sentence: 'Widening the window' }),
    )

    expect(pin.state).toBe('working')
    expect(pin.sentence).toBe('Widening the window')
  })

  test('an event for another ask is none of its business', () => {
    const other: PinEvent = { type: 'status', status: { askId: 'ask_2', status: 'working' } }

    expect(play(fresh(), other)).toEqual(fresh())
  })

  test('a late queued does not pull a working pin back', () => {
    expect(play(working(), status({ status: 'queued' })).state).toBe('working')
  })
})

describe('commits while it works', () => {
  test('are ignored before the turn starts and after it ends', () => {
    const before = play(fresh(), commit(['window_1']))
    const queued = play(fresh(), status({ status: 'queued' }), commit(['window_1']))
    const after = play(
      working(),
      status({ status: 'ended', outcome: 'completed', asked: false, wroteScene: false }),
      commit(['window_1']),
    )

    expect(before.landed).toBe(0)
    expect(queued.landed).toBe(0)
    expect(after.landed).toBe(0)
  })

  test('one that touches a target is a step landing: a pop, and the target changed', () => {
    const pin = play(working(), commit(['window_1']))

    expect(pin.landed).toBe(1)
    expect(pin.changedTargetIds).toEqual(['window_1'])
    expect(pin.alsoChangedIds).toEqual([])
  })

  test('each landing step counts once, the ids once', () => {
    const pin = play(working(), commit(['window_1']), commit(['window_1']), commit(['window_1']))

    expect(pin.landed).toBe(3)
    expect(pin.changedTargetIds).toEqual(['window_1'])
  })

  test('a node inside a target’s subtree is the target changing', () => {
    const inside = (id: string) => id === 'glass_1' || id === 'frame_1'
    const pin = play(working(), commit(['glass_1', 'frame_1'], inside))

    expect(pin.landed).toBe(1)
    expect(pin.changedTargetIds).toEqual(['glass_1', 'frame_1'])
    expect(pin.alsoChangedIds).toEqual([])
  })

  test('what is not the target is "also changed", and is no landing', () => {
    const pin = play(working(), commit(['wall_9', 'item_3']))

    expect(pin.landed).toBe(0)
    expect(pin.changedTargetIds).toEqual([])
    expect(pin.alsoChangedIds).toEqual(['wall_9', 'item_3'])
  })

  test('a mixed commit does both, once each', () => {
    const pin = play(working(), commit(['window_1', 'wall_9']), commit(['wall_9']))

    expect(pin.landed).toBe(1)
    expect(pin.changedTargetIds).toEqual(['window_1'])
    expect(pin.alsoChangedIds).toEqual(['wall_9'])
  })

  test('a member moving into scope stops being an also-changed element', () => {
    const pin = play(
      working(),
      commit(['item_3']),
      commit(['item_3'], () => true),
      commit(['item_3']),
    )

    expect(pin.changedTargetIds).toEqual(['item_3'])
    expect(pin.alsoChangedIds).toEqual([])
    expect(pin.landed).toBe(2)
  })

  test('an empty commit is nothing', () => {
    expect(play(working(), commit([]))).toEqual(working())
  })
})

describe('a question that waits', () => {
  test('asking is needs-input with the question, and the turn is not over', () => {
    const pin = play(working(), status({ status: 'asking', question: 'Which window?' }))

    expect(pin.state).toBe('needs-input')
    expect(pin.question).toBe('Which window?')
    expect(pin.ended).toBe(false)
  })

  test('the answer resumes the turn: working again, the question cleared', () => {
    const pin = play(
      working(),
      status({ status: 'asking', question: 'Which window?' }),
      status({ status: 'working', sentence: 'Widening the north window' }),
    )

    expect(pin.state).toBe('working')
    expect(pin.question).toBeUndefined()
    expect(pin.sentence).toBe('Widening the north window')
  })

  test('commits after the answer count, and a turn that ends still asking needs them', () => {
    const resumed = play(
      working(),
      status({ status: 'asking', question: 'Which?' }),
      status({ status: 'working' }),
      commit(['window_1']),
    )
    expect(resumed.landed).toBe(1)

    const abandoned = play(
      working(),
      status({ status: 'asking', question: 'Which?' }),
      status({ status: 'ended', outcome: 'cancelled', asked: true, wroteScene: false }),
    )
    expect(abandoned.state).toBe('needs-input')
  })

  test('commits while it waits are not the turn writing', () => {
    const pin = play(
      working(),
      status({ status: 'asking', question: 'Which?' }),
      commit(['window_1']),
    )

    expect(pin.landed).toBe(0)
  })
})

describe('the turn ends', () => {
  const ended = (more: Record<string, unknown>) =>
    status({ status: 'ended', outcome: 'completed', asked: false, wroteScene: true, ...more })

  test('completed with a target changed is done', () => {
    const pin = play(working(), commit(['window_1']), ended({}))

    expect(pin.state).toBe('done')
    expect(pin.ended).toBe(true)
    expect(pin.sentence).toBeUndefined()
  })

  test('a done pin keeps the last live sentence as its card title', () => {
    const pin = play(
      working(),
      status({ status: 'working', sentence: 'Widened the window to 1.80 m' }),
      commit(['window_1']),
      ended({}),
    )

    expect(pin.state).toBe('done')
    expect(cardTitle(pin)).toBe('Widened the window to 1.80 m')
  })

  test('completed on a question to the person needs them', () => {
    const pin = play(working(), ended({ asked: true, answer: 'Which window?' }))

    expect(pin.state).toBe('needs-input')
    expect(pin.answer).toBe('Which window?')
  })

  test('completed with no scene write and a reply is an answer', () => {
    const pin = play(working(), ended({ wroteScene: false, answer: 'It is 14.2 m².' }))

    expect(pin.state).toBe('answered')
    expect(pin.answer).toBe('It is 14.2 m².')
  })

  test('completed that changed only other elements is done, with Undo and an honest count', () => {
    const pin = play(working(), commit(['wall_9']), ended({}))

    expect(pin.state).toBe('done')
    expect(pin.landed).toBe(0)
    expect(pin.alsoChangedIds).toEqual(['wall_9'])
    expect(cardTitle(pin)).toBe('Pascal changed 1 element')
    expect(play(pin, { type: 'undo' }).state).toBe('undone')
    expect(play(pin, { type: 'undo' }, { type: 'redo' }).state).toBe('done')
  })

  test('a real material or collection commit is done even without node changes', () => {
    const pin = play(working(), { type: 'commit', changedNodeIds: [], committed: true }, ended({}))

    expect(pin.state).toBe('done')
    expect(pin.landed).toBe(0)
    expect(pin.changedTargetIds).toEqual([])
    expect(pin.alsoChangedIds).toEqual([])
    expect(cardTitle(pin)).toBe('Pascal updated the scene')
    expect(play(pin, { type: 'undo' }).state).toBe('undone')
  })

  test('calling a writing tool without a durable commit still means no change', () => {
    expect(play(working(), ended({})).state).toBe('no-change')
  })

  test('completed with nothing to say and nothing written is no change', () => {
    expect(play(working(), ended({ wroteScene: false })).state).toBe('no-change')
  })

  test('a changed target beats a question', () => {
    const pin = play(working(), commit(['window_1']), ended({ asked: true }))

    expect(pin.state).toBe('done')
  })

  test('errored is an error, with the words', () => {
    const pin = play(
      working(),
      status({
        status: 'ended',
        outcome: 'errored',
        asked: false,
        wroteScene: false,
        error: 'The window is wider than the wall.',
      }),
    )

    expect(pin.state).toBe('error')
    expect(pin.error).toBe('The window is wider than the wall.')
  })

  test('cancelled is done if something landed, no change if not', () => {
    const cancelled = status({
      status: 'ended',
      outcome: 'cancelled',
      asked: false,
      wroteScene: true,
    })

    expect(play(working(), commit(['window_1']), cancelled).state).toBe('done')
    expect(play(working(), commit(['wall_9']), cancelled).state).toBe('done')
    expect(play(working(), cancelled).state).toBe('no-change')
  })

  test('can end from sent or queued, a turn that never reported working', () => {
    expect(play(fresh(), ended({ wroteScene: false })).state).toBe('no-change')
    expect(play(fresh(), status({ status: 'queued' }), ended({ wroteScene: false })).state).toBe(
      'no-change',
    )
  })

  test('ends once: a second end, or a late working, changes nothing', () => {
    const done = play(working(), commit(['window_1']), ended({}))

    expect(play(done, ended({ asked: true }))).toEqual(done)
    expect(play(done, status({ status: 'working', sentence: 'late' }))).toEqual(done)
    expect(play(done, status({ status: 'queued' }))).toEqual(done)
  })
})

describe('Keep and Undo', () => {
  const done = () =>
    play(
      working(),
      commit(['window_1']),
      status({ status: 'ended', outcome: 'completed', asked: false, wroteScene: true }),
    )

  test('Undo turns a done pin to undone', () => {
    const pin = play(done(), { type: 'undo' })

    expect(pin.state).toBe('undone')
    expect(pin.undone).toBe(true)
  })

  test('Undo means nothing from any other state', () => {
    for (const pin of [
      fresh(),
      working(),
      play(
        working(),
        status({ status: 'ended', outcome: 'errored', asked: false, wroteScene: false }),
      ),
    ])
      expect(play(pin, { type: 'undo' })).toEqual(pin)
  })

  test('an undo that failed puts the pin back to done', () => {
    const pin = play(done(), { type: 'undo' }, { type: 'undone', ok: false })

    expect(pin.state).toBe('done')
    expect(pin.undone).toBe(false)
  })

  test('an undo that worked stays undone, and a stray undone changes nothing else', () => {
    const undone = play(done(), { type: 'undo' }, { type: 'undone', ok: true })

    expect(undone.state).toBe('undone')
    expect(play(done(), { type: 'undone', ok: false })).toEqual(done())
  })

  test('Keep marks it kept and leaves the state', () => {
    const pin = play(done(), { type: 'keep' })

    expect(pin.kept).toBe(true)
    expect(pin.state).toBe('done')
    expect(play(pin, { type: 'keep' })).toEqual(pin)
  })

  test('commits after Undo are ignored', () => {
    const pin = play(done(), { type: 'undo' }, commit(['window_1']))

    expect(pin.landed).toBe(1)
  })
})

describe('reducePin is pure', () => {
  test('returns a new pin and leaves the old one alone', () => {
    const pin = fresh()
    const next = play(pin, status({ status: 'working' }), commit(['window_1']))

    expect(next).not.toBe(pin)
    expect(pin).toEqual(fresh())
  })
})

describe('what the card says', () => {
  test('the title the caller built, else the fallback', () => {
    const titled = { ...play(working(), commit(['window_1'])), title: 'Widened to 1.20 m' }

    expect(cardTitle(titled, 'Done')).toBe('Widened to 1.20 m')
    expect(cardTitle(fresh())).toBe('Done')
    expect(cardTitle(fresh(), 'Pascal didn’t change this window.')).toBe(
      'Pascal didn’t change this window.',
    )
  })

  test('the error’s words for an error, the answer’s first two lines for an answer', () => {
    const error = {
      ...fresh(),
      state: 'error' as const,
      error: 'The window is wider than the wall.',
    }
    const answered = {
      ...fresh(),
      state: 'answered' as const,
      answer: 'It is 14.2 m².\nThat is about 150 square feet.\nA third line.',
    }

    expect(cardTitle(error, 'Done')).toBe('The window is wider than the wall.')
    expect(cardTitle(answered, 'Done')).toBe('It is 14.2 m².\nThat is about 150 square feet.')
  })

  test('undone says so', () => {
    expect(cardTitle({ ...fresh(), state: 'undone' as const }, 'Done')).toBe('Undone')
  })

  test('the "also changed" line, singular and plural', () => {
    expect(alsoChangedLine(fresh())).toBeNull()
    expect(alsoChangedLine({ ...fresh(), alsoChangedIds: ['a'] })).toBe(
      'Also changed 1 other element',
    )
    expect(alsoChangedLine({ ...fresh(), alsoChangedIds: ['a', 'b'] })).toBe(
      'Also changed 2 other elements',
    )
  })
})

describe('redo', () => {
  const done = () =>
    play(
      working(),
      commit(['window_1']),
      status({ status: 'ended', outcome: 'completed', asked: false, wroteScene: true }),
    )

  test('brings an undone pin back to done', () => {
    const pin = play(done(), { type: 'undo' }, { type: 'redo' })

    expect(pin.state).toBe('done')
    expect(pin.undone).toBe(false)
  })

  test('is nothing for a pin that was not undone', () => {
    expect(play(done(), { type: 'redo' })).toEqual(done())
  })
})

describe('a card carried out from under the pointer', () => {
  // Boundary events come before the move that caused them, so the leave of a person who moves
  // after a long pause arrives with the old last position: only where the pointer is, against where
  // it was last seen, tells a pointer that walked out from a card that was taken from it.
  const last = { x: 640, y: 380 }

  test('is a mouse that did not move: the camera flew, the person did not leave', () => {
    expect(cardCarriedFromPointer({ pointerType: 'mouse', at: { x: 640, y: 380 }, last })).toBe(
      true,
    )
  })

  test('is not a mouse that moved out, however long it had been still', () => {
    expect(cardCarriedFromPointer({ pointerType: 'mouse', at: { x: 700, y: 560 }, last })).toBe(
      false,
    )
  })

  test('is not a mouse we never saw move', () => {
    expect(
      cardCarriedFromPointer({ pointerType: 'mouse', at: { x: 640, y: 380 }, last: null }),
    ).toBe(false)
  })

  test('is never a finger: lifting it leaves without a move', () => {
    expect(cardCarriedFromPointer({ pointerType: 'touch', at: { x: 640, y: 380 }, last })).toBe(
      false,
    )
  })
})
