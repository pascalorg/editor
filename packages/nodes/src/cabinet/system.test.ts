import { describe, expect, test } from 'bun:test'
import { Group, Mesh } from 'three'
import { collectCabinetFlameObjects } from './flame-index'

describe('collectCabinetFlameObjects', () => {
  test('indexes only animated flame descendants', () => {
    const root = new Group()
    const staticMesh = new Mesh()
    const flame = new Mesh()
    flame.userData.cabinetFlamePulse = { phase: 0, amplitude: 0.1, base: 1 }
    const nested = new Group()
    nested.add(flame)
    root.add(staticMesh, nested)

    expect(collectCabinetFlameObjects(root)).toEqual([flame])
  })
})
