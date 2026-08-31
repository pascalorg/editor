import { describe, expect, test } from 'bun:test'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { resolveTurbineVentMaterialRole, turbineVentPaint } from '../paint'
import { TurbineVentNode } from '../schema'

describe('turbine vent paint', () => {
  test('maps the fixed and spinning meshes to separate roles', () => {
    expect(resolveTurbineVentMaterialRole('turbine-vent-base')).toBe('base')
    expect(resolveTurbineVentMaterialRole('turbine-vent-head')).toBe('head')
  })

  test('updates one role and falls back to the legacy whole-vent material', () => {
    const node = TurbineVentNode.parse({ slots: { base: 'library:steel' } })
    expect(
      turbineVentPaint.buildPatch({
        node,
        role: 'head',
        material: undefined,
        materialPreset: 'library:copper',
      }),
    ).toEqual({
      slots: { base: 'library:steel', head: 'library:copper' },
    })
    expect(
      turbineVentPaint.getEffectiveMaterial?.({ node, role: 'base', nodes: {} })?.materialPreset,
    ).toBe('library:steel')
    expect(
      turbineVentPaint.getEffectiveMaterial?.({ node, role: 'head', nodes: {} })?.materialPreset,
    ).toBe('preset-white')
  })

  test('previews only the selected mesh', () => {
    const baseMaterial = new MeshBasicMaterial()
    const headMaterial = new MeshBasicMaterial()
    const base = new Mesh(undefined, baseMaterial)
    const head = new Mesh(undefined, headMaterial)
    base.name = 'turbine-vent-base'
    head.name = 'turbine-vent-head'
    const root = new Group()
    root.add(base, head)
    const restore = turbineVentPaint.applyPreview({
      node: TurbineVentNode.parse({}),
      role: 'head',
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
    expect(base.material).toBe(baseMaterial)
    expect(head.material).not.toBe(headMaterial)
    restore?.()
    expect(head.material).toBe(headMaterial)
  })
})
