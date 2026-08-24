import { describe, expect, test } from 'bun:test'
import {
  blockFaceOperationCommand,
  blockFaceOperationValueFromPointer,
  blockModalFaceOperationStatus,
} from './modal-face-operation'

describe('block modal face operation', () => {
  test('maps pointer travel to signed extrusion distance', () => {
    const pivot = { x: 0, y: 0 }
    expect(
      blockFaceOperationValueFromPointer('extrude', pivot, { x: 60, y: -30 }, pivot, 2, 200),
    ).toBeCloseTo(0.9)
    expect(
      blockFaceOperationValueFromPointer('extrude', pivot, { x: -60, y: 30 }, pivot, 2, 200),
    ).toBeCloseTo(-0.9)
  })

  test('extrudes along the pointer direction in every screen orientation', () => {
    const start = { x: 100, y: 100 }
    for (const direction of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const current = {
        x: start.x + direction.x * 60,
        y: start.y + direction.y * 60,
      }
      expect(
        blockFaceOperationValueFromPointer('extrude', start, current, start, 2, 200, direction),
      ).toBeCloseTo(0.6)
    }
  })

  test('keeps face-operation sensitivity consistent as projected size changes', () => {
    const pivot = { x: 0, y: 0 }
    const direction = { x: 1, y: 0 }
    const nearExtrude = blockFaceOperationValueFromPointer(
      'extrude',
      pivot,
      { x: 100, y: 0 },
      pivot,
      2,
      400,
      direction,
    )
    const farExtrude = blockFaceOperationValueFromPointer(
      'extrude',
      pivot,
      { x: 50, y: 0 },
      pivot,
      2,
      200,
      direction,
    )
    const nearInset = blockFaceOperationValueFromPointer(
      'inset',
      { x: 200, y: 0 },
      { x: 100, y: 0 },
      pivot,
      2,
      400,
    )
    const farInset = blockFaceOperationValueFromPointer(
      'inset',
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      pivot,
      2,
      200,
    )

    expect(nearExtrude).toBeCloseTo(0.5)
    expect(farExtrude).toBeCloseTo(0.5)
    expect(nearInset).toBeCloseTo(0.25)
    expect(farInset).toBeCloseTo(0.25)
  })

  test('insets toward the face pivot from every screen direction', () => {
    const pivot = { x: 100, y: 100 }
    for (const [start, current] of [
      [
        { x: 180, y: 100 },
        { x: 140, y: 100 },
      ],
      [
        { x: 20, y: 100 },
        { x: 60, y: 100 },
      ],
      [
        { x: 100, y: 20 },
        { x: 100, y: 60 },
      ],
      [
        { x: 100, y: 180 },
        { x: 100, y: 140 },
      ],
    ]) {
      expect(
        blockFaceOperationValueFromPointer('inset', start, current, pivot, 2, 200),
      ).toBeCloseTo(0.2)
    }
  })

  test('reduces inset toward the outside and caps inward travel', () => {
    const pivot = { x: 100, y: 100 }
    expect(
      blockFaceOperationValueFromPointer(
        'inset',
        { x: 180, y: 100 },
        { x: 220, y: 100 },
        pivot,
        2,
        200,
      ),
    ).toBe(0)
    expect(
      blockFaceOperationValueFromPointer(
        'inset',
        { x: 600, y: 100 },
        { x: 100, y: 100 },
        pivot,
        2,
        200,
      ),
    ).toBe(0.95)
  })

  test('creates a pure topology command from the modal value', () => {
    expect(blockFaceOperationCommand('extrude', ['f-top'], -0.4)).toEqual({
      type: 'extrude-faces',
      faceIds: ['f-top'],
      distance: -0.4,
    })
    expect(blockFaceOperationCommand('extrude', ['f-top'], 0.4, 'z')).toEqual({
      type: 'extrude-faces',
      faceIds: ['f-top'],
      distance: 0.4,
      axis: 'z',
    })
    expect(blockFaceOperationCommand('inset', ['f-top'], 0.2)).toEqual({
      type: 'inset-faces',
      faceIds: ['f-top'],
      amount: 0.2,
      depth: 0,
    })
  })

  test('reports operation value and modal controls', () => {
    expect(blockModalFaceOperationStatus('extrude', '0.35', 'grid')).toBe(
      'Extrude · 0.35 m · Grid snap · type value · click applies · Esc cancels',
    )
    expect(blockModalFaceOperationStatus('extrude', '0.35', 'grid', 'z')).toBe(
      'Extrude · 0.35 m · Grid snap · Z axis · type value · click applies · Esc cancels',
    )
    expect(blockModalFaceOperationStatus('inset', '0.2')).toBe(
      'Inset · 0.2 ratio · Free · type value · click applies · Esc cancels',
    )
  })
})
