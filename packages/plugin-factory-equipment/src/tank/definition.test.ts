import { createEquipmentSpecFromBinding, normalizeEquipmentContract } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { tankDefinition } from './definition'
import { buildTankGeometry } from './geometry'
import { factoryTankPorts } from './ports'

describe('factory tank definition', () => {
  test('exposes equipment metadata, ports, and defaults', () => {
    const node = tankDefinition.schema.parse(tankDefinition.defaults())
    const ports = factoryTankPorts(node)

    expect(tankDefinition.kind).toBe('factory:tank')
    expect(tankDefinition.equipment?.family).toBe('tank')
    expect(ports.map((port) => port.id)).toEqual(['inlet', 'outlet'])
  })

  test('accepts industry-pack bindings through core equipment contracts', () => {
    const contract = normalizeEquipmentContract({
      profileId: 'chemical.storage_tank',
      equipmentFamily: 'tank',
      scaleClass: 'skid',
      envelope: { length: 2.4, width: 2.4, height: 3.2, origin: 'profile' },
      ports: [
        { id: 'inlet', medium: 'water', side: 'top', height: 3.2, diameter: 0.16 },
        { id: 'outlet', medium: 'water', side: 'front', height: 0.4, diameter: 0.12 },
      ],
      nodeBinding: {
        profileId: 'chemical.storage_tank',
        nodeKind: 'factory:tank',
        paramMap: {
          orientation: { source: 'literal', value: 'vertical' },
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
      nodeKind: 'factory:tank',
      profileId: 'chemical.storage_tank',
      params: {
        orientation: 'vertical',
        length: 2.4,
        width: 2.4,
        height: 3.2,
        inletDiameter: 0.16,
        outletDiameter: 0.12,
      },
    })
  })

  test('builds stable geometry from one equipment node', () => {
    const node = tankDefinition.schema.parse({
      ...tankDefinition.defaults(),
      id: 'factory-tank_test',
      type: 'factory:tank',
    })
    const group = buildTankGeometry(node)

    expect(group.children.length).toBeGreaterThanOrEqual(6)
    expect(group.children.some((child) => child.name === 'factory-tank-shell')).toBe(true)
    expect(group.children.some((child) => child.name === 'factory-tank-outlet-nozzle')).toBe(true)
  })
})
