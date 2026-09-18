import { describe, expect, test } from 'bun:test'
import { Mesh } from 'three'
import { pipeFittingDefinition } from './definition'
import { buildPipeFittingGeometry } from './geometry'
import { localPipeFittingPorts } from './ports'
import { PipeFittingNode } from './schema'

function fitting(fittingType: PipeFittingNode['fittingType']) {
  return PipeFittingNode.parse({
    ...pipeFittingDefinition.defaults(),
    fittingType,
    diameter: 3,
    diameter2: 2,
  })
}

function meshNames(fittingType: PipeFittingNode['fittingType']) {
  const names: string[] = []
  buildPipeFittingGeometry(fitting(fittingType)).traverse((child) => {
    if (child instanceof Mesh) names.push(child.name)
  })
  return names
}

describe('DWV fitting geometry', () => {
  test.each([
    'elbow',
    'wye',
    'sanitary-tee',
    'cross',
  ] as const)('builds socket and rim details for every %s port', (fittingType) => {
    const node = fitting(fittingType)
    const names = meshNames(fittingType)
    for (const port of localPipeFittingPorts(node)) {
      expect(names).toContain(`pipe-fitting-socket-${port.id}`)
      expect(names).toContain(`pipe-fitting-shoulder-${port.id}`)
      expect(names).toContain(`pipe-fitting-rim-${port.id}`)
    }
  })

  test('models an elbow as a continuous sweep', () => {
    expect(meshNames('elbow')).toContain('pipe-fitting-elbow-sweep')
  })

  test.each([
    'wye',
    'sanitary-tee',
  ] as const)('models %s with a straight run and swept branch', (fittingType) => {
    const names = meshNames(fittingType)
    expect(names).toContain(`pipe-fitting-${fittingType}-run`)
    expect(names).toContain(`pipe-fitting-${fittingType}-branch-sweep`)
  })

  test('models a cross with two independently swept branches', () => {
    const names = meshNames('cross')
    expect(names).toContain('pipe-fitting-cross-run')
    expect(names).toContain('pipe-fitting-cross-branch-sweep')
    expect(names).toContain('pipe-fitting-cross-branch2-sweep')
  })

  test('uses banded collars for cast-iron fittings', () => {
    const node = PipeFittingNode.parse({
      ...pipeFittingDefinition.defaults(),
      fittingType: 'elbow',
      pipeMaterial: 'cast-iron',
    })
    const names: string[] = []
    buildPipeFittingGeometry(node).traverse((child) => {
      if (child instanceof Mesh) names.push(child.name)
    })

    expect(names.filter((name) => name.startsWith('pipe-fitting-band-'))).toHaveLength(4)
  })
})
