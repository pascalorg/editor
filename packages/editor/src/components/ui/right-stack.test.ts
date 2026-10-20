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

test('on a short window the help card scrolls to preserve editing space', () => {
  expect(rightStackFloors({ ...tall, naturalHeight: 500, stackHeight: 400 })).toEqual({
    inspector: 180,
    card: 212,
  })
})

test('expanded hints cannot squeeze the inspector down to just its header', () => {
  expect(rightStackFloors({ ...tall, naturalHeight: 500, stackHeight: 258 })).toEqual({
    inspector: 180,
    card: 70,
  })
})

test('a column shorter than the inspector minimum still bounds both cards', () => {
  expect(rightStackFloors({ ...tall, naturalHeight: 500, stackHeight: 100 })).toEqual({
    inspector: 92,
    card: 0,
  })
})
