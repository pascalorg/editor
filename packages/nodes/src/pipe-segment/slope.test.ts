import { expect, test } from 'bun:test'
import { applyPipeGrade, pipeGrade } from './slope'

test('grade uses horizontal length and signed elevation change', () => {
  const end = applyPipeGrade([0, 3, 0], [3, 3, 4], 0.02)
  expect(end).toEqual([3, 2.9, 4])
  expect(pipeGrade([0, 3, 0], end)).toBeCloseTo(0.02)
  expect(pipeGrade(end, [0, 3, 0])).toBeCloseTo(-0.02)
})
test('rise and zero grade preserve the chosen horizontal endpoint', () => {
  expect(applyPipeGrade([0, 1, 0], [4, 7, 0], -0.025)).toEqual([4, 1.1, 0])
  expect(applyPipeGrade([0, 1, 0], [4, 7, 0], 0)).toEqual([4, 1, 0])
})
test('vertical stacks retain their endpoint without infinite slope', () => {
  expect(applyPipeGrade([0, 3, 0], [0, 0, 0], 0.02)).toEqual([0, 0, 0])
  expect(pipeGrade([0, 3, 0], [0, 0, 0])).toBeNull()
})
