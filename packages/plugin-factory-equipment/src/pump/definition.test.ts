import { describe, expect, test } from 'bun:test'
import { createEquipmentSpecFromBinding, normalizeEquipmentContract } from '@pascal-app/core'
import { pumpDefinition } from './definition'
import { buildPumpGeometry } from './geometry'
import { factoryPumpPorts } from './ports'

describe('factory pump definition', () => {
  test('exposes equipment metadata, ports, and defaults', () => {
    const node = pumpDefinition.schema.parse(pumpDefinition.defaults())
    const ports = factoryPumpPorts(node)

    expect(pumpDefinition.kind).toBe('factory:pump')
    expect(pumpDefinition.equipment?.family).toBe('pump')
    expect(ports.map((port) => port.id)).toEqual(['inlet', 'outlet'])
    expect(ports[0]?.diameter).toBe(node.inletDiameter)
    expect(ports[1]?.diameter).toBe(node.outletDiameter)
  })

  test('accepts industry-pack bindings through core equipment contracts', () => {
    const contract = normalizeEquipmentContract({
      profileId: 'chemical.centrifugal_pump',
      equipmentFamily: 'pump',
      scaleClass: 'skid',
      envelope: { length: 2.6, width: 1.1, height: 1.4, origin: 'profile' },
      ports: [
        { id: 'inlet', medium: 'water', side: 'left', height: 0.55, diameter: 0.18 },
        { id: 'outlet', medium: 'water', side: 'right', height: 0.72, diameter: 0.12 },
      ],
      nodeBinding: {
        profileId: 'chemical.centrifugal_pump',
        nodeKind: 'factory:pump',
        paramMap: {
          pumpType: { source: 'literal', value: 'centrifugal' },
          length: 'envelope.length',
          width: 'envelope.width',
          height: 'envelope.height',
          inletDiameter: 'ports.inlet.diameter',
          outletDiameter: 'ports.outlet.diameter',
        },
      },
    })

    const spec = createEquipmentSpecFromBinding({ contract: contract! })

    expect(spec).toMatchObject({
      nodeKind: 'factory:pump',
      profileId: 'chemical.centrifugal_pump',
      params: {
        pumpType: 'centrifugal',
        length: 2.6,
        width: 1.1,
        height: 1.4,
        inletDiameter: 0.18,
        outletDiameter: 0.12,
      },
    })
  })

  test('builds stable multi-part geometry from one equipment node', () => {
    const node = pumpDefinition.schema.parse({
      ...pumpDefinition.defaults(),
      id: 'factory-pump_test',
      type: 'factory:pump',
    })
    const group = buildPumpGeometry(node)

    expect(group.children.length).toBeGreaterThanOrEqual(8)
    expect(group.children.some((child) => child.name === 'factory-pump-inlet-flange')).toBe(true)
    expect(group.children.some((child) => child.name === 'factory-pump-outlet-flange')).toBe(true)
  })
})
