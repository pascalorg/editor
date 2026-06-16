import { describe, expect, test } from 'bun:test'
import { composeAssemblyPrimitives } from './assembly-compose'
import { extractUserGeometryConstraints } from './assembly-constraints'
import {
  composeAssemblyFromConfig,
  composeAssemblyTemplateParts,
  getAssemblyTemplate,
  resolveAssemblyTemplateStyle,
} from './assembly-template-compose'
import { resolvePrimitiveWorldTransforms } from './primitive-compose'
import { validatePrimitiveSemantics } from './primitive-semantic-validation'

describe('assembly template composition', () => {
  test('resolves vehicle template styles from request text', () => {
    const template = getAssemblyTemplate('vehicle')
    expect(template).toBeDefined()
    if (!template) return

    expect(
      resolveAssemblyTemplateStyle(
        template,
        { family: 'vehicle', prompt: 'compact sports car' },
        extractUserGeometryConstraints('compact sports car'),
      ),
    ).toBe('sports')
    expect(
      resolveAssemblyTemplateStyle(
        template,
        { family: 'vehicle', prompt: 'pickup truck' },
        extractUserGeometryConstraints('pickup truck'),
      ),
    ).toBe('truck')
  })

  test('expands a vehicle template into reusable part specs', () => {
    const template = getAssemblyTemplate('vehicle')
    expect(template).toBeDefined()
    if (!template) return

    const parts = composeAssemblyTemplateParts(
      template,
      { family: 'vehicle', prompt: 'red suv' },
      extractUserGeometryConstraints('red suv'),
      { primaryColor: '#ef4444', sizeScale: 1 },
    )

    const body = parts.find((part) => part.semanticRole === 'vehicle_body')
    expect(body?.kind).toBe('body_shell')
    expect(body?.vehicleStyle).toBe('suv')
    expect(body?.length).toBeCloseTo(4.4)
    expect(body?.width).toBeCloseTo(1.892)
    expect(body?.height).toBeCloseTo(1.672)
    expect(body?.primaryColor).toBe('#ef4444')
    expect(body?.cornerRadius).toBeCloseTo(0.13376)
    expect(parts.some((part) => part.kind === 'wheel_set')).toBe(true)
    expect(parts.some((part) => part.kind === 'window_strip')).toBe(true)
  })

  test('composes vehicle geometry directly from the TypeScript template config', () => {
    const template = getAssemblyTemplate('vehicle')
    expect(template).toBeDefined()
    if (!template) return

    const shapes = composeAssemblyFromConfig(
      template,
      { family: 'vehicle', prompt: 'compact blue car', length: 2, primaryColor: '#1E90FF' },
      extractUserGeometryConstraints('compact blue car', {
        family: 'vehicle',
        length: 2,
        primaryColor: '#1E90FF',
      }),
      { primaryColor: '#1E90FF', sizeScale: 0.8 },
    )

    const body = shapes.find((shape) => shape.semanticRole === 'vehicle_body')
    expect(body?.length).toBe(2)
    expect(body?.material?.properties?.color).toBe('#1E90FF')
    expect(shapes.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
    expect(shapes.some((shape) => shape.semanticRole === 'vehicle_window')).toBe(true)
  })

  test('composes configured vehicle assemblies with hard user constraints preserved', () => {
    const shapes = composeAssemblyPrimitives({
      family: 'vehicle',
      prompt: 'blue sports car',
      length: 5,
      width: 2,
      height: 1,
    })

    const body = shapes.find((shape) => shape.semanticRole === 'vehicle_body')
    expect(body?.length).toBe(5)
    expect(body?.width).toBe(2)
    expect(body?.material?.properties?.color).toBe('#2563eb')
    expect(shapes.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
    expect(shapes.some((shape) => shape.semanticRole === 'vehicle_window')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'vehicle_roof')).toBe(true)
  })

  test('keeps fan head centered on the motor in direct assembly generation', () => {
    const shapes = composeAssemblyPrimitives({
      family: 'fan',
      prompt: '\u751f\u6210\u4e00\u53f0\u98ce\u6247',
    })

    const motor = shapes.find((shape) => shape.semanticRole === 'motor_housing')
    const hub = shapes.find((shape) => shape.name?.includes('blade hub'))
    const grill = shapes.find((shape) => shape.name?.includes('grill front ring 5'))
    const pole = shapes.find((shape) => shape.semanticRole === 'vertical_pole')

    expect(motor?.position?.[1]).toBeCloseTo(hub?.position?.[1] ?? 0)
    expect(grill?.position?.[1]).toBeCloseTo(hub?.position?.[1] ?? 0)
    expect(motor?.position?.[1]).toBeCloseTo(
      (pole?.position?.[1] ?? 0) + (pole?.height ?? 0) / 2 + (motor?.radius ?? 0),
    )
  })

  test('composes spherical tank assemblies with a supported sphere shell', () => {
    const shapes = composeAssemblyPrimitives({
      family: 'tank',
      object: '球罐',
      prompt: '生成一个直径4米的球罐',
      diameter: 4,
    })

    const shell = shapes.find((shape) => shape.semanticRole === 'vessel_shell')
    expect(shell?.kind).toBe('sphere')
    expect(shell?.sourcePartKind).toBe('process.spherical_vessel')
    expect(shell?.radius).toBeCloseTo(2)
    expect(shapes.filter((shape) => shape.semanticRole === 'support_leg')).toHaveLength(4)
    expect(shapes.some((shape) => shape.semanticRole === 'inlet_port')).toBe(true)
  })

  test('keeps truck default proportions in the configured path', () => {
    const shapes = composeAssemblyPrimitives({ family: 'vehicle', prompt: 'pickup truck' })
    const body = shapes.find((shape) => shape.semanticRole === 'vehicle_body')

    expect(body?.length).toBeCloseTo(5.2)
    expect(body?.width).toBeCloseTo(2.236)
    expect(body?.height).toBeCloseTo(0.63232)
  })

  test('accepts small blue car generation briefs that ask for taillights', () => {
    const shapes = composeAssemblyPrimitives({
      family: 'vehicle',
      prompt: '生成一蓝色小汽车，两米长度',
      length: 2,
      primaryColor: '#1E90FF',
    })

    const result = validatePrimitiveSemantics(
      shapes,
      resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' }),
      {
        prompt: '生成一蓝色小汽车，两米长度',
        sourceArgs: {
          family: 'vehicle',
          length: 2,
          primaryColor: '#1E90FF',
        },
        geometryBrief: {
          category: 'vehicle',
          requiredRoles: [
            'vehicle_body',
            'vehicle_tire',
            'vehicle_window',
            'vehicle_headlight',
            'vehicle_taillight',
          ],
        },
      },
    )

    const body = shapes.find((shape) => shape.semanticRole === 'vehicle_body')
    expect(result.ok).toBe(true)
    expect(result.issues).not.toContain('required semantic role "vehicle_taillight" is missing.')
    expect(body?.length).toBe(2)
    expect(body?.material?.properties?.color).toBe('#1E90FF')
    expect(shapes.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
  })
})
