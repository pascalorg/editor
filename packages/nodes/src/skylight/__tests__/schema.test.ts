import { describe, expect, test } from 'bun:test'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { skylightDefinition } from '../../index'
import { SkylightNode } from '../schema'

describe('SkylightNode schema', () => {
  test('parses with the flat preset defaults', () => {
    const parsed = SkylightNode.parse({})
    expect(parsed.type).toBe('skylight')
    expect(parsed.id).toMatch(/^skylight_/)
    expect(parsed.skylightType).toBe('flat')
    expect(parsed.width).toBe(0.9)
    expect(parsed.height).toBe(1.2)
    expect(parsed.curb).toBe(true)
    expect(parsed.operationState).toBe(0)
  })

  test('accepts every type', () => {
    for (const t of ['flat', 'walk-on', 'lantern', 'opening', 'sliding'] as const) {
      expect(SkylightNode.parse({ skylightType: t }).skylightType).toBe(t)
    }
  })

  test('operationState / slideFraction clamped to [0, 1]', () => {
    expect(() => SkylightNode.parse({ operationState: -0.1 })).toThrow()
    expect(() => SkylightNode.parse({ operationState: 1.1 })).toThrow()
    expect(() => SkylightNode.parse({ slideFraction: -0.1 })).toThrow()
    expect(() => SkylightNode.parse({ slideFraction: 1.1 })).toThrow()
  })

  test('rejects unknown enums', () => {
    expect(() => SkylightNode.parse({ openingSide: 'middle' })).toThrow()
    expect(() => SkylightNode.parse({ slideDirection: 'y' })).toThrow()
  })
})

test('painting the glass preserves the frame and survives serialization', () => {
  const node = SkylightNode.parse({ materialPreset: 'library:preset-white' })
  const paint = skylightDefinition.capabilities!.paint!
  const patch = paint.buildPatch({
    node,
    role: 'glass',
    material: undefined,
    materialPreset: 'library:preset-glass',
  })
  const restored = SkylightNode.parse(JSON.parse(JSON.stringify({ ...node, ...patch })))
  expect(restored.materialPreset).toBe('library:preset-white')
  expect(restored.glassMaterialPreset).toBe('library:preset-glass')
  expect(
    paint.getEffectiveMaterial!({ node: restored, role: 'glass', nodes: {} }).materialPreset,
  ).toBe('library:preset-glass')
})

test('paint preview restores the glass and leaves its frame untouched', () => {
  const frame = new MeshBasicMaterial()
  const face = new MeshBasicMaterial()
  const root = new Group()
  const mesh = new Mesh(undefined, face)
  mesh.name = 'skylight-glass'
  root.add(mesh)
  const frameMesh = new Mesh(undefined, frame)
  frameMesh.name = 'skylight-surface'
  root.add(frameMesh)
  const paint = skylightDefinition.capabilities!.paint!
  const node = skylightDefinition.schema.parse({})
  expect(paint.resolveRole({ node, hitObject: mesh, materialIndex: 1 } as never)).toBe('glass')
  const restore = paint.applyPreview({
    node,
    role: 'glass',
    root,
    material: undefined,
    materialPreset: 'library:preset-white',
  })
  expect(mesh.material).not.toBe(face)
  expect(frameMesh.material).toBe(frame)
  restore?.()
  expect(mesh.material).toEqual(face)
})
