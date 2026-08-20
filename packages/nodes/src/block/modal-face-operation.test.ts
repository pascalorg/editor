import { describe, expect, test } from 'bun:test'
import {
  blockFaceOperationCommand,
  blockFaceOperationValueFromPointer,
  blockModalFaceOperationStatus,
} from './modal-face-operation'

describe('block modal face operation', () => {
  test('maps pointer travel to signed extrusion distance and bounded inset amount', () => {
    expect(blockFaceOperationValueFromPointer('extrude', 60, -30, 2)).toBeCloseTo(0.9)
    expect(blockFaceOperationValueFromPointer('extrude', -60, 30, 2)).toBeCloseTo(-0.9)
    expect(blockFaceOperationValueFromPointer('inset', 60, -30, 2)).toBeCloseTo(0.45)
    expect(blockFaceOperationValueFromPointer('inset', 500, -500, 2)).toBe(0.95)
  })

  test('creates a pure topology command from the modal value', () => {
    expect(blockFaceOperationCommand('extrude', 'f-top', -0.4)).toEqual({
      type: 'extrude-face',
      faceId: 'f-top',
      distance: -0.4,
    })
    expect(blockFaceOperationCommand('inset', 'f-top', 0.2)).toEqual({
      type: 'inset-face',
      faceId: 'f-top',
      amount: 0.2,
      depth: 0,
    })
  })

  test('reports operation value and modal controls', () => {
    expect(blockModalFaceOperationStatus('extrude', '0.35', 'grid')).toBe(
      'Extrude · 0.35 m · Grid snap · type value · click applies · Esc cancels',
    )
    expect(blockModalFaceOperationStatus('inset', '0.2')).toBe(
      'Inset · 0.2 ratio · Free · type value · click applies · Esc cancels',
    )
  })
})
