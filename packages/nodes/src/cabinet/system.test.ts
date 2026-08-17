import { describe, expect, test } from 'bun:test'
import { Group, Mesh } from 'three'
import { collectCabinetFlameObjects } from './flame-index'
import { animateCabinetFlames } from './system'

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

describe('animateCabinetFlames', () => {
  test('continues animating after a throttled flame jet', () => {
    const jet = new Mesh()
    jet.userData.cabinetFlameJet = { seed: {}, burnerR: 0.1 }
    const pulse = new Mesh()
    pulse.userData.cabinetFlamePulse = { phase: Math.PI / 2, amplitude: 0.2, base: 1 }

    animateCabinetFlames([jet, pulse], 0, false)

    expect(pulse.scale.x).toBeCloseTo(1.2)
  })
})
