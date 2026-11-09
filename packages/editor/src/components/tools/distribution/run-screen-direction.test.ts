import { expect, test } from 'bun:test'
import { chooseScreenDirection, screenDirectionScore } from './run-screen-direction'

test('picks the visually closest guide including diagonals', () => {
  const pointer = [75, -60] as const
  const scores = [
    [100, 0],
    [70, -70],
    [0, -100],
  ].map((tip) => screenDirectionScore([0, 0], tip as [number, number], pointer))
  expect(chooseScreenDirection(scores, -1)).toBe(1)
})

test('small jitter keeps the guide but deliberate movement switches', () => {
  expect(chooseScreenDirection([12, 10], 0)).toBe(0)
  expect(chooseScreenDirection([20, 10], 0)).toBe(1)
})

test('camera-facing and backwards guides do not capture the cursor', () => {
  expect(screenDirectionScore([0, 0], [0.1, 0.2], [50, 50])).toBe(Infinity)
  expect(screenDirectionScore([0, 0], [-100, 0], [50, 0])).toBe(Infinity)
  expect(chooseScreenDirection([Infinity, Infinity], 0)).toBe(-1)
})
