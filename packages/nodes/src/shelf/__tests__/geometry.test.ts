import { describe, expect, test } from 'bun:test'
import type { Mesh } from 'three'
import { buildShelfGeometry } from '../geometry'
import { ShelfNode } from '../schema'

describe('buildShelfGeometry', () => {
  test('returns a Group with named meshes for top + brackets (minimal style)', () => {
    const node = ShelfNode.parse({ bracketStyle: 'minimal' })
    const group = buildShelfGeometry(node)
    const names = group.children.map((c) => c.name)
    expect(names).toContain('shelf-top')
    expect(names).toContain('shelf-bracket-left')
    expect(names).toContain('shelf-bracket-right')
    expect(group.children.length).toBe(3)
  })

  test('hidden bracket style omits both brackets', () => {
    const node = ShelfNode.parse({ bracketStyle: 'hidden' })
    const group = buildShelfGeometry(node)
    expect(group.children.length).toBe(1)
    expect(group.children[0]!.name).toBe('shelf-top')
  })

  test('top board y-center matches height + thickness/2', () => {
    const node = ShelfNode.parse({ height: 1.0, thickness: 0.05 })
    const group = buildShelfGeometry(node)
    const top = group.children.find((c) => c.name === 'shelf-top') as Mesh | undefined
    expect(top).toBeDefined()
    expect(top!.position.y).toBeCloseTo(1.0 + 0.025)
  })

  test('brackets are inset from the shelf ends and run from the floor to the top', () => {
    const node = ShelfNode.parse({ width: 1.5, height: 0.8 })
    const group = buildShelfGeometry(node)
    const left = group.children.find((c) => c.name === 'shelf-bracket-left') as Mesh | undefined
    const right = group.children.find((c) => c.name === 'shelf-bracket-right') as Mesh | undefined
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    // Left bracket sits at negative X, right at positive X.
    expect(left!.position.x).toBeLessThan(0)
    expect(right!.position.x).toBeGreaterThan(0)
    // Brackets rise from floor (y = bracketHeight/2 ≈ 0.4 for height 0.8).
    expect(left!.position.y).toBeCloseTo(0.4)
  })

  test('industrial bracket style produces thicker bracket boxes', () => {
    const minimal = buildShelfGeometry(ShelfNode.parse({ bracketStyle: 'minimal', depth: 0.4 }))
    const industrial = buildShelfGeometry(
      ShelfNode.parse({ bracketStyle: 'industrial', depth: 0.4 }),
    )
    const minimalBracket = minimal.children.find((c) => c.name === 'shelf-bracket-left') as Mesh
    const industrialBracket = industrial.children.find(
      (c) => c.name === 'shelf-bracket-left',
    ) as Mesh
    // industrial bracket box should have a wider X (bracketWidth) than minimal
    const minimalParams = (minimalBracket.geometry as any).parameters
    const industrialParams = (industrialBracket.geometry as any).parameters
    expect(industrialParams.width).toBeGreaterThan(minimalParams.width)
  })

  test('top board material is built from node.color (not the default)', () => {
    const defaultColor = (
      buildShelfGeometry(ShelfNode.parse({})).children.find((c) => c.name === 'shelf-top') as Mesh
    ).material as { color: { getHexString(): string } }
    const custom = (
      buildShelfGeometry(ShelfNode.parse({ color: '#112233' })).children.find(
        (c) => c.name === 'shelf-top',
      ) as Mesh
    ).material as { color: { getHexString(): string } }
    // Three.js applies color space conversion (sRGB → linear) for materials.
    // The materials should differ — that's the property we care about, not the
    // exact channel values.
    expect(custom.color.getHexString()).not.toBe(defaultColor.color.getHexString())
  })
})
