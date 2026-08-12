import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { emitter, type GridEvent } from '@pascal-app/core'
import useMeasurementInput from '../store/use-measurement-input'
import { createMeasurementInputBridge } from './measurement-input-bridge'

// The bridge only ever stores and re-emits the event, so a positional stub is
// enough — but it still has to satisfy `GridEvent`, which carries the pointer
// event the tools read.
const GRID_EVENT: GridEvent = {
  position: [3, 0, 4],
  localPosition: [3, 0, 4],
  nativeEvent: {} as GridEvent['nativeEvent'],
}

let dispose: (() => void) | null = null

beforeEach(() => {
  useMeasurementInput.setState({ buffer: '', field: 'length' })
  dispose = createMeasurementInputBridge()
})

afterEach(() => {
  dispose?.()
  dispose = null
  useMeasurementInput.setState({ buffer: '', field: 'length' })
})

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('typed value replays the last pointer event', () => {
  test('typing re-emits grid:move so a still mouse still updates the draft', () => {
    emitter.emit('grid:move', GRID_EVENT)

    let moves = 0
    const count = () => {
      moves += 1
    }
    emitter.on('grid:move', count)

    useMeasurementInput.getState().append('4')
    expect(moves).toBe(1)

    useMeasurementInput.getState().append('.')
    expect(moves).toBe(2)

    emitter.off('grid:move', count)
  })

  test('the replayed event carries the last real cursor position', () => {
    emitter.emit('grid:move', GRID_EVENT)

    const seen: GridEvent[] = []
    const capture = (event: GridEvent) => {
      seen.push(event)
    }
    emitter.on('grid:move', capture)

    useMeasurementInput.getState().append('4')
    expect(seen).toEqual([GRID_EVENT])

    emitter.off('grid:move', capture)
  })

  test('nothing is replayed before the pointer has ever been over the grid', () => {
    let moves = 0
    const count = () => {
      moves += 1
    }
    emitter.on('grid:move', count)

    useMeasurementInput.getState().append('4')
    expect(moves).toBe(0)

    emitter.off('grid:move', count)
  })
})

describe('Enter commits at the typed value', () => {
  test('tool:commit replays the pointer event as a click', () => {
    emitter.emit('grid:move', GRID_EVENT)

    let clicks = 0
    const count = () => {
      clicks += 1
    }
    emitter.on('grid:click', count)

    useMeasurementInput.getState().append('4')
    emitter.emit('tool:commit')
    expect(clicks).toBe(1)

    emitter.off('grid:click', count)
  })
})

describe('a committed point consumes the typed value', () => {
  test('the buffer clears after a click, so a chain does not inherit it', async () => {
    emitter.emit('grid:move', GRID_EVENT)
    useMeasurementInput.getState().append('4')
    expect(useMeasurementInput.getState().buffer).toBe('4')

    emitter.emit('grid:click', GRID_EVENT)
    await flush()
    expect(useMeasurementInput.getState().buffer).toBe('')
  })

  test('the value is still readable while the click is being handled', () => {
    emitter.emit('grid:move', GRID_EVENT)
    useMeasurementInput.getState().append('4')

    const bufferDuringClick: string[] = []
    const readDuringClick = () => {
      bufferDuringClick.push(useMeasurementInput.getState().buffer)
    }
    emitter.on('grid:click', readDuringClick)

    emitter.emit('grid:click', GRID_EVENT)
    // The clear is deferred, so a tool reading the value in its own click
    // handler still sees it — that is what makes the commit land at 4.
    expect(bufferDuringClick).toEqual(['4'])

    emitter.off('grid:click', readDuringClick)
  })
})

describe('disposal', () => {
  test('a disposed bridge stops replaying', () => {
    emitter.emit('grid:move', GRID_EVENT)
    dispose?.()
    dispose = null

    let moves = 0
    const count = () => {
      moves += 1
    }
    emitter.on('grid:move', count)

    useMeasurementInput.getState().append('4')
    expect(moves).toBe(0)

    emitter.off('grid:move', count)
  })
})
