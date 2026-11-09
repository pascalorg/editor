import { expect, test } from 'bun:test'
import { rightStackFloors } from './right-stack'

const tall = { headerHeight: 52, cardHeight: 240 }

test('the inspector keeps 180 px, or its own height if shorter, above the full card', () => {
  expect(rightStackFloors({ ...tall, naturalHeight: 500, stackHeight: 700 })).toEqual({
    inspector: 180,
    card: 240,
  })
  expect(rightStackFloors({ ...tall, naturalHeight: 120, stackHeight: 700 }).inspector).toBe(120)
  expect(
    rightStackFloors({ naturalHeight: 0, headerHeight: 0, cardHeight: 240, stackHeight: 700 }),
  ).toEqual({ inspector: 0, card: 240 })
})

test('on a short window the inspector gives way first, down to its header', () => {
  expect(rightStackFloors({ ...tall, naturalHeight: 500, stackHeight: 400 })).toEqual({
    inspector: 152,
    card: 240,
  })
})

test('on a very short window the inspector keeps its header and the card scrolls', () => {
  expect(rightStackFloors({ ...tall, naturalHeight: 500, stackHeight: 258 })).toEqual({
    inspector: 52,
    card: 198,
  })
})
