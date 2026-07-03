import { describe, expect, test } from 'bun:test'
import {
  createEquipmentSpecFromBinding,
  equipmentPortKey,
  type EquipmentContract,
  normalizeEquipmentContract,
  normalizeEquipmentEnvelope,
  normalizeEquipmentNodeBinding,
  normalizeEquipmentPort,
  normalizeIndustryPluginPackManifest,
} from './equipment-contracts'

describe('equipment contracts', () => {
  const pumpContract = {
    profileId: 'chemical.centrifugal_pump',
    equipmentFamily: 'pump',
    scaleClass: 'skid',
    envelope: { length: 2.4, width: 1.1, height: 1.35, origin: 'profile', tolerance: 0.05 },
    ports: [
      { id: 'inlet', medium: 'water', side: 'left', height: 0.55, diameter: 0.15 },
      { id: 'outlet', medium: 'water', side: 'right', height: 0.72, diameter: 0.1 },
    ],
    requiredRoles: ['transfer'],
    primarySemanticRole: 'pump',
  } satisfies EquipmentContract

  test('normalizes equipment envelope and ports', () => {
    const inletPort = pumpContract.ports[0]!

    expect(normalizeEquipmentEnvelope(pumpContract.envelope)).toEqual(pumpContract.envelope)
    expect(normalizeEquipmentPort(inletPort)).toEqual(inletPort)
    expect(normalizeEquipmentContract(pumpContract)).toEqual(pumpContract)
    expect(equipmentPortKey('chemical.centrifugal_pump', 'inlet')).toBe(
      'chemical.centrifugal_pump:inlet',
    )
  })

  test('rejects invalid dimensions, ports, and contracts', () => {
    expect(normalizeEquipmentEnvelope({ length: 0, width: 1, height: 1, origin: 'profile' })).toBe(
      null,
    )
    expect(normalizeEquipmentPort({ id: 'inlet', medium: 'water', side: 'left' })).toBe(null)
    expect(normalizeEquipmentContract({ ...pumpContract, ports: [{ id: 'broken' }] })).toBe(null)
  })

  test('normalizes bindings and resolves equipment specs from contract paths', () => {
    const binding = normalizeEquipmentNodeBinding({
      profileId: 'chemical.centrifugal_pump',
      nodeKind: 'factory:pump',
      requiredPluginId: '@pascal/plugin-factory-equipment',
      paramMap: {
        pumpType: { source: 'literal', value: 'centrifugal' },
        length: 'envelope.length',
        flowMedium: 'ports.inlet.medium',
        inletDiameter: 'ports.inlet.diameter',
        outletDiameter: 'ports.outlet.diameter',
        motorPower: { source: 'contract', path: 'metadata.motorPower', fallback: 15 },
      },
      portMap: { inlet: 'inlet', outlet: 'outlet' },
    })
    const contract = normalizeEquipmentContract({ ...pumpContract, nodeBinding: binding })

    expect(binding).toMatchObject({
      profileId: 'chemical.centrifugal_pump',
      nodeKind: 'factory:pump',
      portMap: { inlet: 'inlet', outlet: 'outlet' },
    })
    expect(contract?.nodeBinding?.nodeKind).toBe('factory:pump')
    expect(
      createEquipmentSpecFromBinding({
        contract: contract!,
        position: [1, 0, 2],
        rotation: [0, Math.PI / 2, 0],
      }),
    ).toEqual({
      nodeKind: 'factory:pump',
      profileId: 'chemical.centrifugal_pump',
      params: {
        pumpType: 'centrifugal',
        length: 2.4,
        flowMedium: 'water',
        inletDiameter: 0.15,
        outletDiameter: 0.1,
        motorPower: 15,
      },
      position: [1, 0, 2],
      rotation: [0, Math.PI / 2, 0],
    })
  })

  test('normalizes industry plugin manifests with equipment bindings', () => {
    expect(
      normalizeIndustryPluginPackManifest({
        id: 'chemical-process-pack',
        name: 'Chemical Process Pack',
        industry: 'chemical',
        version: '0.1.0',
        schemaVersion: 1,
        pluginApiVersion: 1,
        dependsOnPlugins: ['@pascal/plugin-factory-equipment'],
        equipmentBindings: [
          {
            profileId: 'chemical.centrifugal_pump',
            nodeKind: 'factory:pump',
            paramMap: { length: 'envelope.length' },
          },
        ],
      }),
    ).toMatchObject({
      id: 'chemical-process-pack',
      dependsOnPlugins: ['@pascal/plugin-factory-equipment'],
      equipmentBindings: [{ profileId: 'chemical.centrifugal_pump', nodeKind: 'factory:pump' }],
    })
  })
})
