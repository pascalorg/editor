import { describe, expect, test } from 'bun:test'
import {
  applyDimensionSemanticsToObjectInput,
  parseDimensionSemantics,
} from './dimension-semantics'
import { composeObjectPrimitives } from './object-compose'

describe('dimension semantics', () => {
  test('parses labeled Chinese dimensions and converts units to meters', () => {
    const dimensions = parseDimensionSemantics('生成一个写字桌，长120cm，宽60cm，高75cm')

    expect(dimensions.length).toBeCloseTo(1.2)
    expect(dimensions.width).toBeCloseTo(0.6)
    expect(dimensions.height).toBeCloseTo(0.75)
  })

  test('parses compact dimensions with a shared trailing unit', () => {
    const dimensions = parseDimensionSemantics('做一个桌子 120x60x75cm')

    expect(dimensions.length).toBeCloseTo(1.2)
    expect(dimensions.width).toBeCloseTo(0.6)
    expect(dimensions.height).toBeCloseTo(0.75)
  })

  test('parses diameter and derives radius', () => {
    const dimensions = parseDimensionSemantics('直径300mm 高1.2m 的过滤器')

    expect(dimensions.diameter).toBeCloseTo(0.3)
    expect(dimensions.radius).toBeCloseTo(0.15)
    expect(dimensions.height).toBeCloseTo(1.2)
  })

  test('parses modern Chinese numeric and numeral dimensions', () => {
    expect(
      parseDimensionSemantics(
        '\u751f\u6210\u4e00\u4e2a\u6ce2\u97f3717\u5ba2\u673a\uff0c\u957f\u5ea6\u4e94\u7c73',
      ).length,
    ).toBeCloseTo(5)

    const dimensions = parseDimensionSemantics('\u957f5\u7c73 \u5bbd\u4e24\u7c73 \u9ad81.2\u7c73')

    expect(dimensions.length).toBeCloseTo(5)
    expect(dimensions.width).toBeCloseTo(2)
    expect(dimensions.height).toBeCloseTo(1.2)
  })

  test('maps desk length and width to real table footprint', () => {
    const input = applyDimensionSemanticsToObjectInput(
      { category: 'table' as const },
      '生成一个写字桌，长120cm 宽60cm 高75cm',
    )
    const shapes = composeObjectPrimitives(input)
    const top = shapes.find((shape) => shape.name?.includes('top'))

    expect(input.width).toBeCloseTo(1.2)
    expect(input.depth).toBeCloseTo(0.6)
    expect(input.height).toBeCloseTo(0.75)
    expect(top?.length).toBeCloseTo(1.2)
    expect(top?.width).toBeCloseTo(0.6)
  })

  test('maps vehicle length to object length/depth axis', () => {
    const input = applyDimensionSemanticsToObjectInput(
      { category: 'vehicle' as const },
      '汽车长4.8米 宽1.9米 高1.6米',
    )

    expect(input.length).toBeCloseTo(4.8)
    expect(input.width).toBeCloseTo(1.9)
    expect(input.height).toBeCloseTo(1.6)
  })
})
