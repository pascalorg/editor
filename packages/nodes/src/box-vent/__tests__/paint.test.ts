import { describe, expect, test } from 'bun:test'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { boxVentPaint, resolveBoxVentMaterialRole } from '../paint'
import { BoxVentNode } from '../schema'

describe('box vent paint', () => {
  test('maps geometry material groups to base and top roles', () => {
    expect(resolveBoxVentMaterialRole(0)).toBe('base')
    expect(resolveBoxVentMaterialRole(1)).toBe('top')
  })

  test('updates only the painted role', () => {
    const node = BoxVentNode.parse({ slots: { base: 'library:metal-steel' } })
    expect(
      boxVentPaint.buildPatch({
        node,
        role: 'top',
        material: undefined,
        materialPreset: 'library:roof-shingle',
      }),
    ).toEqual({
      slots: { base: 'library:metal-steel', top: 'library:roof-shingle' },
    })
  })

  test('keeps the legacy whole-vent material as an independent fallback', () => {
    const node = BoxVentNode.parse({ materialPreset: 'preset-white' })
    expect(
      boxVentPaint.getEffectiveMaterial?.({ node, role: 'top', nodes: {} })?.materialPreset,
    ).toBe('preset-white')
  })

  test('previews the top without replacing the base material', () => {
    const base = new MeshBasicMaterial()
    const top = new MeshBasicMaterial()
    const mesh = new Mesh(undefined, [base, top])
    mesh.name = 'box-vent-surface'
    const root = new Group()
    root.add(mesh)

    const restore = boxVentPaint.applyPreview({
      node: BoxVentNode.parse({}),
      role: 'top',
      material: {
        preset: 'custom',
        properties: {
          color: '#123456',
          roughness: 0.5,
          metalness: 0,
          opacity: 1,
          transparent: false,
          side: 'front',
        },
      },
      materialPreset: undefined,
      root,
    })

    expect(Array.isArray(mesh.material)).toBe(true)
    expect(mesh.material[0]).toBe(base)
    expect(mesh.material[1]).not.toBe(top)

    restore?.()
    expect(mesh.material).toEqual([base, top])
  })
})
