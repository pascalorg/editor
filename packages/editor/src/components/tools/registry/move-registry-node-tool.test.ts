import { expect, test } from 'bun:test'
import { resolveMoveRotationStep } from './move-registry-node-tool'

test('applies a free rotation step while the move is unattached', () => {
  expect(resolveMoveRotationStep(0.5, 0.25, null)).toBeCloseTo(0.75)
})

test('rejects rotation steps while the move is wall-attached', () => {
  expect(resolveMoveRotationStep(0.5, 0.25, Math.PI / 2)).toBeNull()
})
