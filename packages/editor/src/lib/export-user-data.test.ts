import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { uniform } from 'three/tsl'
import { cloneExportUserData } from './export-user-data'

describe('cloneExportUserData', () => {
  test('keeps plain data and deep-copies it', () => {
    const source = {
      pascalId: 'wall-1',
      pascalSwingLeaf: { axis: 'y', openRotationY: 1.2 },
      tags: ['a', 'b'],
      offsets: new Float32Array([1, 2, 3]),
    }
    const copy = cloneExportUserData(source)
    expect(copy).toEqual(source)
    expect(copy.pascalSwingLeaf).not.toBe(source.pascalSwingLeaf)
    expect(copy.tags).not.toBe(source.tags)
    expect(copy.offsets).not.toBe(source.offsets)
  })

  test('drops functions and live three resources instead of throwing', () => {
    const material = new THREE.MeshStandardMaterial()
    material.addEventListener('dispose', () => {})
    const source = {
      pascalId: 'pool-1',
      waterEffect: { material, uniforms: { time: uniform(0) }, strength: 0.5 },
      mesh: new THREE.Mesh(new THREE.BoxGeometry(), material),
      geometry: new THREE.BufferGeometry(),
      texture: new THREE.Texture(),
      onDispose: () => {},
      list: [material, 'kept'],
    }
    expect(() => structuredClone(source)).toThrow()
    expect(cloneExportUserData(source)).toEqual({
      pascalId: 'pool-1',
      waterEffect: { uniforms: {}, strength: 0.5 },
      list: [undefined, 'kept'],
    })
  })

  test('tolerates cycles', () => {
    const source: Record<string, unknown> = { pascalId: 'x' }
    source.self = source
    const copy = cloneExportUserData(source)
    expect(copy.pascalId).toBe('x')
    expect(copy.self).toBe(copy)
  })
})
