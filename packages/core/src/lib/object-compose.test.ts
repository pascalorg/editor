import { describe, expect, test } from 'bun:test'
import { composeObjectPrimitives } from './object-compose'

describe('composeObjectPrimitives', () => {
  test('vehicle template uses rounded body boxes and x-axis wheels', () => {
    const shapes = composeObjectPrimitives({ category: 'vehicle', model: 'Tesla Model Y' })

    const lowerBody = shapes.find((shape) => shape.name?.includes('lower body'))
    expect(lowerBody?.kind).toBe('box')
    expect(lowerBody?.cornerRadius).toBeGreaterThan(0)

    const canopy = shapes.find((shape) => shape.name?.includes('cabin canopy'))
    expect(canopy?.kind).toBe('sphere')

    const tires = shapes.filter((shape) => shape.name?.includes('tire'))
    expect(tires).toHaveLength(4)
    expect(tires.every((shape) => shape.axis === 'x')).toBe(true)
  })

  test('outdoor AC template includes rounded case, hollow fan grille, and fan blades', () => {
    const shapes = composeObjectPrimitives({ category: 'outdoor-ac' })

    const caseShape = shapes.find((shape) => shape.name?.includes('metal case'))
    expect(caseShape?.kind).toBe('box')
    expect(caseShape?.cornerRadius).toBeGreaterThan(0)

    const fanGrille = shapes.find((shape) => shape.name?.includes('circular fan grille'))
    expect(fanGrille?.kind).toBe('cylinder')
    expect(fanGrille?.wallThickness).toBeGreaterThan(0)

    const blades = shapes.filter((shape) => shape.name?.includes('fan blade'))
    expect(blades).toHaveLength(4)
    expect(blades.every((shape) => shape.kind === 'box' && (shape.cornerRadius ?? 0) > 0)).toBe(
      true,
    )
  })

  test('sofa template uses soft capsule arms and rounded cushions', () => {
    const shapes = composeObjectPrimitives({ category: 'sofa' })
    expect(shapes.some((shape) => shape.kind === 'capsule' && shape.name?.includes('arm'))).toBe(
      true,
    )
    expect(shapes.some((shape) => shape.kind === 'rounded-panel')).toBe(true)
  })

  test('keyboard template uses rounded keycaps and a sweep cable', () => {
    const shapes = composeObjectPrimitives({ category: 'keyboard' })
    const keys = shapes.filter((shape) => shape.name?.includes('key '))
    expect(keys.length).toBeGreaterThan(12)
    expect(keys.every((shape) => shape.kind === 'rounded-panel')).toBe(true)
    expect(shapes.some((shape) => shape.kind === 'sweep' && shape.name?.includes('cable'))).toBe(
      true,
    )
  })

  test('monitor template uses rounded screen panels, capsule stand, and cable sweep', () => {
    const shapes = composeObjectPrimitives({ category: 'monitor' })
    expect(
      shapes.some((shape) => shape.kind === 'rounded-panel' && shape.name?.includes('screen')),
    ).toBe(true)
    expect(shapes.some((shape) => shape.kind === 'capsule' && shape.name?.includes('stand'))).toBe(
      true,
    )
    expect(shapes.some((shape) => shape.kind === 'sweep' && shape.name?.includes('cable'))).toBe(
      true,
    )
  })
})
